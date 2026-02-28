import { mountGame } from "./bootstrap";

const appRoot = document.querySelector("#app");
if (appRoot instanceof HTMLElement) {
  mountGame(appRoot);
}
