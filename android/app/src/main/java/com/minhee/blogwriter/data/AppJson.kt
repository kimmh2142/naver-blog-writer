package com.minhee.blogwriter.data

import kotlinx.serialization.json.Json

/** 로컬 저장과 (Phase 2부터) 네트워크에 함께 쓰는 JSON 설정. 필드가 늘어나도 예전 파일을 읽을 수 있게 한다. */
val AppJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
