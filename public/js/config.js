/* 單一 server URL 入口。部署時由 GitHub Actions 以 repo variable GAME_SERVER_URL 取代下行。
   單機版不需要伺服器，留空即可；線上版啟用後才會讀取。 */
window.AMAZE_CONFIG = { serverUrl: '__GAME_SERVER_URL__', lobbyUrl: 'https://pjh-eric.github.io/game-lobby/' };
