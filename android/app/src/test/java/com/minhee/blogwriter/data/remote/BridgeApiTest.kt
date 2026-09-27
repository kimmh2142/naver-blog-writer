package com.minhee.blogwriter.data.remote

import com.minhee.blogwriter.data.model.AiProviderId
import kotlinx.coroutines.test.runTest
import java.io.File
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class BridgeApiTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        runCatching { server.shutdown() }
    }

    private fun api(token: String = "token-123") = BridgeApi(server.url("/").toString(), token)

    // 브리지 GET /v1/status 실제 응답 형태 (확인에 쓴 값)
    private val statusJson = """
        {"bridge":{"version":"0.1.0","startedAt":"2026-09-28T01:00:00.000Z"},
         "providers":{
          "claude":{"provider":"claude","ready":true,"code":"READY","message":"사용 가능","plan":"Claude Pro",
            "usage":[{"name":"5시간","usedPercent":50,"resetsAt":"2026-09-27T16:50:00Z"}],
            "billingCheck":"ok","models":{"analysis":"sonnet","writing":"opus"},"checkedAt":"2026-09-28T01:00:00Z"},
          "codex":{"provider":"codex","ready":false,"code":"AUTH_REQUIRED","message":"로그인 필요","plan":null,
            "usage":[],"billingCheck":"unknown","models":{"analysis":null,"writing":null},"checkedAt":"2026-09-28T01:00:00Z"}}}
    """.trimIndent()

    @Test
    fun parsesStatusAndSendsBearerToken() = runTest {
        server.enqueue(MockResponse().setBody(statusJson))
        val result = api().status(refresh = true)

        val request = server.takeRequest()
        assertEquals("Bearer token-123", request.getHeader("Authorization"))
        assertEquals("/v1/status?refresh=1", request.path)

        val status = (result as BridgeResult.Ok).value
        assertTrue(status.providers.getValue("claude").ready)
        assertEquals(50.0, status.providers.getValue("claude").usage.single().usedPercent!!, 0.0)
        assertEquals("AUTH_REQUIRED", status.providers.getValue("codex").code)
    }

    @Test
    fun unauthorizedIsReportedAsTokenProblem() = runTest {
        server.enqueue(MockResponse().setResponseCode(401).setBody("""{"error":{"code":"UNAUTHORIZED"}}"""))
        assertEquals(BridgeErrorKind.UNAUTHORIZED, (api().status(false) as BridgeResult.Err).error.kind)
    }

    @Test
    fun badGatewayMeansBridgeNotRunning() = runTest {
        // tailscale serve는 뒤의 브리지가 꺼져 있으면 502를 돌려준다
        server.enqueue(MockResponse().setResponseCode(502))
        assertEquals(BridgeErrorKind.BRIDGE_NOT_RUNNING, (api().status(false) as BridgeResult.Err).error.kind)
    }

    @Test
    fun otherErrorsShowBridgeMessage() = runTest {
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"INTERNAL","message":"브리지 내부 오류"}}"""))
        val error = (api().status(false) as BridgeResult.Err).error
        assertEquals(BridgeErrorKind.SERVER, error.kind)
        assertTrue(error.message.contains("브리지 내부 오류"))
    }

    @Test
    fun unreachablePcIsReported() = runTest {
        val api = api()
        server.shutdown()
        assertEquals(BridgeErrorKind.PC_UNREACHABLE, (api.status(false) as BridgeResult.Err).error.kind)
    }

    @Test
    fun analyzeSendsMetaAndJpegFilePartsInOrder() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"provider":"codex","model":"gpt-6-astra","analysisVersion":"v1",
                   "results":[{"photoId":"p-2","analysis":{"type":"food","description":"짬뽕","visibleText":"","tags":["짬뽕"],"uncertain":["양산인지 우산인지 불확실"]}}],
                   "failed":[{"photoId":"p-1","reason":"분석 결과에 이 사진이 없음"}]}""",
            ),
        )
        val first = File.createTempFile("photo-a", ".jpg").apply { writeBytes(byteArrayOf(-1, -40, -1, 1)); deleteOnExit() }
        val second = File.createTempFile("photo-b", ".jpg").apply { writeBytes(byteArrayOf(-1, -40, -1, 2)); deleteOnExit() }

        val result = api().analyzePhotos(AiProviderId.CODEX, "RESTAURANT", "돈거돈락", listOf("p-1" to first, "p-2" to second))

        val request = server.takeRequest()
        assertEquals("/v1/photos/analyze", request.path)
        assertTrue(request.getHeader("Content-Type")!!.startsWith("multipart/form-data"))
        val body = request.body.readUtf8()
        assertTrue(body.contains(""""provider":"codex""""))
        assertTrue(body.contains(""""analysisVersion":"v1""""))
        assertTrue(body.contains(""""photoIds":["p-1","p-2"]"""))
        assertTrue(body.indexOf("""filename="p-1.jpg"""") < body.indexOf("""filename="p-2.jpg""""))
        assertTrue(body.contains("Content-Type: image/jpeg"))

        val response = (result as BridgeResult.Ok).value
        assertEquals("gpt-6-astra", response.model)
        assertEquals(listOf("양산인지 우산인지 불확실"), response.results.single().analysis.uncertain)
        assertEquals("p-1", response.failed.single().photoId)
    }

    @Test
    fun bridgeErrorCodeIsKeptEvenOn502() = runTest {
        // 브리지 JSON 오류는 코드 그대로, JSON이 아닌 502는 브리지 미실행
        server.enqueue(MockResponse().setResponseCode(502).setBody("""{"error":{"code":"INVALID_OUTPUT","message":"분석 결과 형식 오류"}}"""))
        val error = (api().status(false) as BridgeResult.Err).error
        assertEquals(BridgeErrorKind.SERVER, error.kind)
        assertEquals("INVALID_OUTPUT", error.code)

        server.enqueue(MockResponse().setResponseCode(403).setBody("""{"error":{"code":"BILLING_RISK","message":"초과 사용 켜짐"}}"""))
        val blocked = (api().status(false) as BridgeResult.Err).error
        assertEquals("BILLING_RISK", blocked.code)
        assertEquals("초과 사용 켜짐", blocked.message)
    }

    @Test
    fun generatePostsJsonAndParsesResult() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"provider":"codex","model":"gpt-6-astra",
                   "post":{"titleCandidates":["a","b","c"],"blocks":[{"type":"imageGroup","text":"","photoIds":["p1"]},{"type":"paragraph","text":"본문","photoIds":[]}],
                           "hashtags":["#군산"],"confirmNeeded":["가게 이름"],"isCampaign":true,
                           "campaignChecks":[{"requirement":"사진 15장 이상","status":"UNMET","note":"앱에서 고른 사진 1장 (필요 15장)","checkedBy":"code"}]},
                   "validation":{"repaired":false,"items":[{"label":"사진","status":"PASS","detail":"1/1장"}]}}""",
            ),
        )
        val request = GenerateRequest(
            provider = "codex", category = "TRAVEL", subjectName = "군산", memo = "메모", style = mapOf("endings" to "~했어요"),
            photos = listOf(GeneratePhoto("p1", 0, com.minhee.blogwriter.data.model.PhotoAnalysis(type = "food", description = "짬뽕"))),
        )
        val result = api().generatePost(request)

        val sent = server.takeRequest()
        assertEquals("/v1/posts/generate", sent.path)
        assertTrue(sent.getHeader("Content-Type")!!.startsWith("application/json"))
        val body = sent.body.readUtf8()
        assertTrue(body.contains(""""provider":"codex""""))
        assertTrue(body.contains(""""description":"짬뽕""""))

        val response = (result as BridgeResult.Ok).value
        assertEquals("gpt-6-astra", response.model)
        assertEquals(listOf("p1"), response.post.blocks.first().photoIds)
        assertEquals("PASS", response.validation.items.single().status)
        assertTrue(response.post.isCampaign)
        assertEquals("UNMET", response.post.campaignChecks.single().status)
        assertEquals("code", response.post.campaignChecks.single().checkedBy)
    }

    @Test
    fun missingUrlOrTokenIsNotConfigured() = runTest {
        assertFalse(BridgeApi("", "token").isConfigured)
        assertFalse(BridgeApi(server.url("/").toString(), "").isConfigured)
        assertEquals(BridgeErrorKind.NOT_CONFIGURED, (BridgeApi("", "t").status(false) as BridgeResult.Err).error.kind)
        assertEquals(0, server.requestCount)
    }
}
