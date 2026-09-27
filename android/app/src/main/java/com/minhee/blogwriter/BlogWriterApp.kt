package com.minhee.blogwriter

import androidx.compose.runtime.Composable
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.minhee.blogwriter.ui.home.HomeScreen
import com.minhee.blogwriter.ui.newpost.NewPostScreen
import com.minhee.blogwriter.ui.result.ResultScreen
import com.minhee.blogwriter.ui.settings.SettingsScreen

object Routes {
    const val HOME = "home"
    const val NEW_POST = "newpost?draftId={draftId}"
    const val RESULT = "result/{draftId}"
    const val SETTINGS = "settings"

    fun newPost(draftId: String? = null) = if (draftId == null) "newpost" else "newpost?draftId=$draftId"
    fun result(draftId: String) = "result/$draftId"
}

@Composable
fun BlogWriterApp() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                onNewPost = { navController.navigate(Routes.newPost()) },
                onOpenDraft = { id -> navController.navigate(Routes.newPost(id)) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(
            Routes.NEW_POST,
            arguments = listOf(navArgument("draftId") { type = NavType.StringType; nullable = true }),
        ) {
            NewPostScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.RESULT) {
            ResultScreen(onBack = { navController.popBackStack() })
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
