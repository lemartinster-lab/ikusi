// Evita la ventana de consola extra en Windows en la versión de release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ikusi_lib::run()
}
