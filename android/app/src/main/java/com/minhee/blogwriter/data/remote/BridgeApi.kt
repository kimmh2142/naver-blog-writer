package com.minhee.blogwriter.data.remote

import com.minhee.blogwriter.data.AppJson
import com.minhee.blogwriter.data.model.BridgeStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
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

    /** 브리지가 오류 응답을 돌려줌 */
    SERVER,

    /** 응답을 해석할 수 없음 */
    BAD_RESPONSE,
}

data class BridgeError(val kind: BridgeErrorKind, val message: String)

sealed interface BridgeResult<out T> {
    data class Ok<T>(val value: T) : BridgeResult<T>
    data class Err(val error: BridgeError) : BridgeResult<Nothing>
}

/**
 * Windows PC 브리지 클라이언트. 1단계는 상태 조회만 있다.
 * 주소와 토큰은 BuildConfig(= git 제외 local.properties)에서 온다.
 */
class BridgeApi(
    private val baseUrl: String,
    private val token: String,
    private val client: OkHttpClient = defaultClient(),
) {
    val isConfigured: Boolean get() = baseUrl.toHttpUrlOrNull() != null && token.isNotBlank()

    /** 두 Provider의 로그인·과금 안전·사용량 상태. 브리지는 모델을 호출하지 않는다. */
    suspend fun status(refresh: Boolean): BridgeResult<BridgeStatus> = withContext(Dispatchers.IO) {
        val root = baseUrl.toHttpUrlOrNull()
        if (root == null || token.isBlank()) {
            return@withContext BridgeResult.Err(
                BridgeError(
                    BridgeErrorKind.NOT_CONFIGURED,
                    "브리지 주소 또는 토큰이 설정되지 않았어요. PC의 bridge 폴더에서 `npm run setup-token` 실행 후 앱을 다시 빌드하세요.",
                ),
            )
        }
        val url = root.newBuilder()
            .addPathSegments("v1/status")
            .apply { if (refresh) addQueryParameter("refresh", "1") }
            .build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer $token").get().build()
        try {
            client.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                when {
                    response.isSuccessful -> try {
                        BridgeResult.Ok(AppJson.decodeFromString<BridgeStatus>(body))
                    } catch (e: SerializationException) {
                        BridgeResult.Err(BridgeError(BridgeErrorKind.BAD_RESPONSE, "브리지 응답을 해석하지 못했어요: ${e.message}"))
                    } catch (e: IllegalArgumentException) {
                        BridgeResult.Err(BridgeError(BridgeErrorKind.BAD_RESPONSE, "브리지 응답을 해석하지 못했어요: ${e.message}"))
                    }
                    response.code == 401 -> BridgeResult.Err(
                        BridgeError(BridgeErrorKind.UNAUTHORIZED, "앱 토큰이 브리지와 달라요. `npm run setup-token` 후 앱을 다시 빌드하세요."),
                    )
                    response.code in 502..504 -> BridgeResult.Err(
                        BridgeError(BridgeErrorKind.BRIDGE_NOT_RUNNING, "PC에는 연결됐지만 브리지가 실행 중이 아니에요. PC에서 `npm start`를 실행하세요."),
                    )
                    else -> BridgeResult.Err(
                        BridgeError(BridgeErrorKind.SERVER, "브리지 오류 (${response.code}): ${errorMessage(body)}"),
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

    private fun errorMessage(body: String): String = try {
        AppJson.parseToJsonElement(body).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content ?: body.take(200)
    } catch (e: Exception) {
        body.take(200)
    }

    companion object {
        // Claude 상태 확인은 CLI를 띄우므로 수 초가 걸릴 수 있다.
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}
