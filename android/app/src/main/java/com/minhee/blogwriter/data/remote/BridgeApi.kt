package com.minhee.blogwriter.data.remote

import com.minhee.blogwriter.data.AppJson
import com.minhee.blogwriter.data.model.AiProviderId
import com.minhee.blogwriter.data.model.BridgeStatus
import com.minhee.blogwriter.data.model.PhotoAnalysis
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

enum class BridgeErrorKind {
    /** local.properties에 주소나 토큰이 없음 */
    NOT_CONFIGURED,

    /** PC 꺼짐, Tailscale 끊김 등으로 PC에 닿지 않음 */
    PC_UNREACHABLE,

    /** PC에는 닿았지만 브리지가 실행 중이 아님 (tailscale serve가 502 등을 돌려줌) */
    BRIDGE_NOT_RUNNING,

    /** 앱 토큰 불일치 */
    UNAUTHORIZED,

    /** 브리지가 오류 응답을 돌려줌. code에 브리지 오류 코드(USAGE_LIMIT, BILLING_RISK 등) */
    SERVER,

    /** 응답을 해석할 수 없음 */
    BAD_RESPONSE,
}

data class BridgeError(val kind: BridgeErrorKind, val message: String, val code: String? = null)

sealed interface BridgeResult<out T> {
    data class Ok<T>(val value: T) : BridgeResult<T>
    data class Err(val error: BridgeError) : BridgeResult<Nothing>
}

@Serializable
data class AnalyzeResponse(
    val provider: String,
    val model: String? = null,
    val analysisVersion: String,
    val results: List<AnalyzedPhoto> = emptyList(),
    val failed: List<FailedPhoto> = emptyList(),
)

@Serializable
data class AnalyzedPhoto(val photoId: String, val analysis: PhotoAnalysis)

@Serializable
data class FailedPhoto(val photoId: String, val reason: String)

@Serializable
private data class AnalyzeMeta(
    val provider: String,
    val analysisVersion: String,
    val photoIds: List<String>,
    val category: String,
    val subjectName: String,
)

/**
 * Windows PC 브리지 클라이언트. 주소와 토큰은 BuildConfig(= git 제외 local.properties)에서 온다.
 */
class BridgeApi(
    private val baseUrl: String,
    private val token: String,
    private val client: OkHttpClient = defaultClient(),
) {
    val isConfigured: Boolean get() = baseUrl.toHttpUrlOrNull() != null && token.isNotBlank()

    /** 두 Provider의 로그인·과금 안전·사용량 상태. 브리지는 모델을 호출하지 않는다. */
    suspend fun status(refresh: Boolean): BridgeResult<BridgeStatus> {
        val root = rootOrNull() ?: return notConfigured()
        val url = root.newBuilder()
            .addPathSegments("v1/status")
            .apply { if (refresh) addQueryParameter("refresh", "1") }
            .build()
        return execute(Request.Builder().url(url).get(), client) { AppJson.decodeFromString<BridgeStatus>(it) }
    }

    /**
     * 사진 한 배치를 분석한다. photos의 순서가 곧 사진 순서다.
     * 사진은 AI용으로 줄인 JPEG 파일을 그대로 multipart 파일 파트로 보낸다(base64로 바꾸지 않음).
     */
    suspend fun analyzePhotos(
        provider: AiProviderId,
        category: String,
        subjectName: String,
        photos: List<Pair<String, File>>,
    ): BridgeResult<AnalyzeResponse> {
        val root = rootOrNull() ?: return notConfigured()
        val meta = AnalyzeMeta(
            provider = provider.id,
            analysisVersion = PhotoAnalysis.CURRENT_VERSION,
            photoIds = photos.map { it.first },
            category = category,
            subjectName = subjectName,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("meta", null, AppJson.encodeToString(AnalyzeMeta.serializer(), meta).toRequestBody(JSON))
            .apply { photos.forEach { (id, file) -> addFormDataPart("photo", "$id.jpg", file.asRequestBody(JPEG)) } }
            .build()
        val url = root.newBuilder().addPathSegments("v1/photos/analyze").build()
        // 모델 호출이라 오래 걸릴 수 있다(브리지 시간 제한 150초 + 대기).
        val slow = client.newBuilder().readTimeout(ANALYZE_READ_TIMEOUT_S, TimeUnit.SECONDS).build()
        return execute(Request.Builder().url(url).post(body), slow) { AppJson.decodeFromString<AnalyzeResponse>(it) }
    }

    private fun rootOrNull(): HttpUrl? = baseUrl.toHttpUrlOrNull()?.takeIf { token.isNotBlank() }

    private fun notConfigured() = BridgeResult.Err(
        BridgeError(
            BridgeErrorKind.NOT_CONFIGURED,
            "브리지 주소 또는 토큰이 설정되지 않았어요. PC의 bridge 폴더에서 `npm run setup-token` 실행 후 앱을 다시 빌드하세요.",
        ),
    )

    private suspend fun <T> execute(builder: Request.Builder, http: OkHttpClient, parse: (String) -> T): BridgeResult<T> =
        withContext(Dispatchers.IO) {
            val request = builder.header("Authorization", "Bearer $token").build()
            try {
                http.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (response.isSuccessful) {
                        return@use try {
                            BridgeResult.Ok(parse(body))
                        } catch (e: SerializationException) {
                            badResponse(e)
                        } catch (e: IllegalArgumentException) {
                            badResponse(e)
                        }
                    }
                    val (code, message) = errorBody(body)
                    when {
                        response.code == 401 -> BridgeResult.Err(
                            BridgeError(BridgeErrorKind.UNAUTHORIZED, "앱 토큰이 브리지와 달라요. `npm run setup-token` 후 앱을 다시 빌드하세요.", code),
                        )
                        // 브리지 JSON이 아닌 502~504는 tailscale serve가 "뒤의 브리지가 꺼져 있음"을 뜻한다.
                        code == null && response.code in 502..504 -> BridgeResult.Err(
                            BridgeError(BridgeErrorKind.BRIDGE_NOT_RUNNING, "PC에는 연결됐지만 브리지가 실행 중이 아니에요. PC에서 `npm start`를 실행하세요."),
                        )
                        else -> BridgeResult.Err(
                            BridgeError(BridgeErrorKind.SERVER, message ?: "브리지 오류 (${response.code})", code),
                        )
                    }
                }
            } catch (e: IOException) {
                BridgeResult.Err(
                    BridgeError(
                        BridgeErrorKind.PC_UNREACHABLE,
                        "PC 브리지에 연결할 수 없어요. PC 전원, 휴대폰과 PC의 Tailscale 연결을 확인하세요. (${e.javaClass.simpleName})",
                    ),
                )
            }
        }

    private fun badResponse(e: Exception) =
        BridgeResult.Err(BridgeError(BridgeErrorKind.BAD_RESPONSE, "브리지 응답을 해석하지 못했어요: ${e.message}"))

    /** 브리지 오류 본문 {"error":{"code","message"}}. JSON이 아니면 (null, null). */
    private fun errorBody(body: String): Pair<String?, String?> = try {
        val error = AppJson.parseToJsonElement(body).jsonObject["error"]?.jsonObject
        error?.get("code")?.jsonPrimitive?.content to error?.get("message")?.jsonPrimitive?.content
    } catch (e: Exception) {
        null to null
    }

    companion object {
        private val JSON = "application/json; charset=utf-8".toMediaType()
        private val JPEG = "image/jpeg".toMediaType()
        private const val ANALYZE_READ_TIMEOUT_S = 240L

        // Claude 상태 확인은 CLI를 띄우므로 수 초가 걸릴 수 있다.
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .build()
    }
}
