import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const publicMediapipeDir = path.join(root, "public", "mediapipe");
const wasmSrcDir = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDestDir = path.join(publicMediapipeDir, "wasm");
const modelDest = path.join(publicMediapipeDir, "hand_landmarker.task");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function downloadFile(url, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download model. Status: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", async () => {
        try {
          await fs.writeFile(dest, Buffer.concat(chunks));
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });

    request.on("error", reject);
  });
}

async function main() {
  await fs.mkdir(publicMediapipeDir, { recursive: true });
  await copyDirectory(wasmSrcDir, wasmDestDir);
  await downloadFile(modelUrl, modelDest);
  console.log("MediaPipe assets prepared in public/mediapipe");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
