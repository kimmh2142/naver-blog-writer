package com.minhee.blogwriter.data

import android.util.Log
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.minhee.blogwriter.data.model.StyleProfile
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** 문체 프로필 하나를 DataStore의 JSON 문자열 키 하나에 저장한다. */
class StyleRepository(private val dataStore: DataStore<Preferences>) {

    val profile: Flow<StyleProfile> = dataStore.data.map { prefs ->
        prefs[KEY]?.let { json ->
            try {
                AppJson.decodeFromString<StyleProfile>(json)
            } catch (e: Exception) {
                Log.w(TAG, "문체 프로필을 읽지 못함", e)
                null
            }
        } ?: StyleProfile()
    }

    suspend fun save(profile: StyleProfile) {
        dataStore.edit { prefs ->
            prefs[KEY] = AppJson.encodeToString(StyleProfile.serializer(), profile)
        }
    }

    private companion object {
        const val TAG = "StyleRepository"
        val KEY = stringPreferencesKey("style_profile_json")
    }
}
