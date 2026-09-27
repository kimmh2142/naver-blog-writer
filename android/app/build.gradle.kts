import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val localProps = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

// local.properties의 blogwriter.* 값을 읽고, 없거나 숫자가 아니면 기본값을 쓴다.
fun intProp(key: String, default: Int): String =
    (localProps.getProperty(key)?.trim()?.toIntOrNull() ?: default).toString()

// 비밀값/주소는 git에 올라가지 않는 local.properties에서만 읽는다. 없으면 빈 문자열(앱에서 "설정 안 됨" 표시).
fun stringProp(key: String): String {
    val value = localProps.getProperty(key)?.trim().orEmpty()
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

android {
    namespace = "com.minhee.blogwriter"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.minhee.blogwriter"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("int", "ANALYSIS_BATCH_SIZE", intProp("blogwriter.analysisBatchSize", 5))
        buildConfigField("int", "ANALYSIS_CONCURRENCY", intProp("blogwriter.analysisConcurrency", 3))
        buildConfigField("int", "AI_IMAGE_LONG_EDGE_PX", intProp("blogwriter.aiImageLongEdgePx", 1280))
        buildConfigField("int", "AI_IMAGE_JPEG_QUALITY", intProp("blogwriter.aiImageJpegQuality", 80))

        // PC 브리지 (bridge/에서 `npm run setup-token`이 local.properties에 채운다)
        buildConfigField("String", "BRIDGE_URL", stringProp("blogwriter.bridgeUrl"))
        buildConfigField("String", "BRIDGE_TOKEN", stringProp("blogwriter.bridgeToken"))
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        // AtomicFile 등이 android.util.Log를 호출해도 JVM 단위 테스트가 죽지 않게 한다.
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.5")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.5")
    implementation("androidx.navigation:navigation-compose:2.8.0")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.2")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
