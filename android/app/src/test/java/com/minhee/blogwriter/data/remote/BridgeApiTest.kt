package com.minhee.blogwriter.data.remote

import kotlinx.coroutines.test.runTest
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
    fun missingUrlOrTokenIsNotConfigured() = runTest {
        assertFalse(BridgeApi("", "token").isConfigured)
        assertFalse(BridgeApi(server.url("/").toString(), "").isConfigured)
        assertEquals(BridgeErrorKind.NOT_CONFIGURED, (BridgeApi("", "t").status(false) as BridgeResult.Err).error.kind)
        assertEquals(0, server.requestCount)
    }
}
