package com.minhee.blogwriter

import android.app.Application
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.viewmodel.CreationExtras

class BlogWriterApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** ViewModel 팩토리에서 AppContainer를 꺼낸다. */
val CreationExtras.appContainer: AppContainer
    get() = (this[APPLICATION_KEY] as BlogWriterApplication).container
