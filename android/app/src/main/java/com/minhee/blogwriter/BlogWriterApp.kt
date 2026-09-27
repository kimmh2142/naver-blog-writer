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
    const val NEW_POST = "newpost?draftId={draftId}&regenerate={regenerate}"
    const val RESULT = "result/{draftId}"
    const val SETTINGS = "settings"

    /** regenerate: 입력 화면을 열면서 바로 그 AI로 원고를 다시 만든다 (결과 화면의 "다시 생성"). */
    fun newPost(draftId: String? = null, regenerate: String? = null) = buildString {
        append("newpost")
        val params = listOfNotNull(draftId?.let { "draftId=$it" }, regenerate?.let { "regenerate=$it" })
        if (params.isNotEmpty()) append("?").append(params.joinToString("&"))
    }

    fun result(draftId: String) = "result/$draftId"
}

@Composable
fun BlogWriterApp() {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                onNewPost = { navController.navigate(Routes.newPost()) },
                onOpenDraft = { id, hasResult -> navController.navigate(if (hasResult) Routes.result(id) else Routes.newPost(id)) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS) },
            )
        }
        composable(
            Routes.NEW_POST,
            arguments = listOf(
                navArgument("draftId") { type = NavType.StringType; nullable = true },
                navArgument("regenerate") { type = NavType.StringType; nullable = true },
            ),
        ) {
            NewPostScreen(
                onBack = { navController.popBackStack() },
                onOpenResult = { id -> navController.navigate(Routes.result(id)) },
            )
        }
        composable(Routes.RESULT) {
            ResultScreen(
                onBack = { navController.popBackStack() },
                onEdit = { id -> navController.navigate(Routes.newPost(id)) { popUpTo(Routes.HOME) } },
                onRegenerate = { id, provider -> navController.navigate(Routes.newPost(id, provider.id)) { popUpTo(Routes.HOME) } },
            )
        }
        composable(Routes.SETTINGS) {
            SettingsScreen(onBack = { navController.popBackStack() })
        }
    }
}
