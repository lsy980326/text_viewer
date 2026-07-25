use tauri_plugin_sql::{Migration, MigrationKind};

const DATABASE_URL: &str = "sqlite:novelier.db";

fn database_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create local novel library",
        sql: include_str!("../migrations/0001_initial.sql"),
        kind: MigrationKind::Up,
    }]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|_app| {
            #[cfg(desktop)]
            {
                use tauri::Manager;
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                let primary_modifier = if cfg!(target_os = "macos") {
                    Modifiers::SUPER
                } else {
                    Modifiers::CONTROL
                };
                let quick_hide_shortcut =
                    Shortcut::new(Some(primary_modifier | Modifiers::SHIFT), Code::KeyH);

                _app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state != ShortcutState::Pressed
                                || shortcut != &quick_hide_shortcut
                            {
                                return;
                            }

                            let Some(window) = app.get_webview_window("main") else {
                                return;
                            };
                            let visible = window.is_visible().unwrap_or(false);
                            let minimized = window.is_minimized().unwrap_or(false);
                            if visible && !minimized {
                                let _ = window.minimize();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        })
                        .build(),
                )?;

                if let Err(error) = _app.global_shortcut().register(quick_hide_shortcut) {
                    eprintln!("NOVELIER quick-hide shortcut could not be registered: {error}");
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, database_migrations())
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("error while building NOVELIER");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen {
            has_visible_windows,
            ..
        } = _event
        {
            if !has_visible_windows {
                use tauri::Manager;

                if let Some(window) = _app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
    });
}
