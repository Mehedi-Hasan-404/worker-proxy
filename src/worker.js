addEventListener("fetch", event => {
  event.respondWith(handleRequest(event.request));
});

const options = {
  originBlacklist: ["*"],
  originWhitelist: [],
};

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    return serveIndexHtml();
  } else if (url.pathname === "/m3u8-proxy") {
    return handleM3U8Proxy(request);
  } else if (url.pathname === "/ts-proxy") {
    return handleTsProxy(request);
  }

  return new Response("Not Found", { status: 404 });
}

async function serveIndexHtml() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>M3U8 Proxy Player</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="https://vjs.zencdn.net/7.21.0/video-js.css" rel="stylesheet" />
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f0f0f0; }
    .container { max-width: 800px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
    input[type="text"] { width: 100%; padding: 10px; font-size: 16px; margin-bottom: 10px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 20px; font-size: 16px; margin-right: 10px; cursor: pointer; border: none; border-radius: 4px; }
    .play-btn { background-color: #28a745; color: white; }
    .clear-btn { background-color: #dc3545; color: white; }
    #result { margin-top: 10px; font-size: 14px; word-break: break-word; }
    .video-js { width: 100%; max-height: 480px; margin-top: 20px; background: black; }
  </style>
</head>
<body>
  <div class="container">
    <h2>M3U8 Proxy Player</h2>
    <input type="text" id="streamUrl" placeholder="Enter M3U8 stream URL..." />
    <button class="play-btn" onclick="playStream()">Play</button>
    <button class="clear-btn" onclick="clearStream()">Clear</button>
    <div id="result"></div>
    <video id="videoPlayer" class="video-js vjs-default-skin vjs-big-play-centered" controls preload="auto"></video>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  <script src="https://vjs.zencdn.net/7.21.0/video.min.js"></script>
  <script>
    let hls;
    const workerBase = location.origin;
    const video = document.getElementById("videoPlayer");
    const player = videojs(video);

    function playStream() {
      const inputUrl = document.getElementById("streamUrl").value.trim();
      const resultDiv = document.getElementById("result");

      if (!inputUrl) return;

      const proxiedUrl = \`\${workerBase}/m3u8-proxy?url=\${encodeURIComponent(inputUrl)}\`;
      resultDiv.innerHTML = \`<strong>Trying Direct:</strong> <a href="\${inputUrl}" target="_blank">\${inputUrl}</a><br><strong>Fallback Proxy:</strong> <a href="\${proxiedUrl}" target="_blank">\${proxiedUrl}</a>\`;

      player.pause();
      player.reset();

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(inputUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, function (event, data) {
          if (data.type === 'networkError') {
            console.warn("Direct failed, switching to proxy...");
            hls.destroy();
            hls = new Hls();
            hls.loadSource(proxiedUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => player.play());
          }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => player.play());
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = inputUrl;
        video.addEventListener("error", () => {
          console.warn("Direct failed, switching to proxy...");
          video.src = proxiedUrl;
          video.play();
        });
        video.addEventListener("loadedmetadata", () => video.play());
      }
    }

    function clearStream() {
      document.getElementById("streamUrl").value = "";
      document.getElementById("result").innerHTML = "";
      if (hls) hls.destroy();
      player.pause();
      player.reset();
    }
  </script>
</body>
</html>
  `.trim();

  return new Response(html, {
    headers: {
      "Content-Type": "text/html",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function handleM3U8Proxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Referer": targetUrl,
    "Origin": new URL(targetUrl).origin,
  };

  if (!targetUrl) {
    return new Response("URL is required", { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, { headers });
    if (!response.ok) {
      return new Response("Failed to fetch the m3u8 file", { status: response.status });
    }

    let m3u8 = await response.text();
    m3u8 = m3u8
      .split("\n")
      .filter(line => !line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO"))
      .join("\n");

    const lines = m3u8.split("\n");
    const newLines = [];

    for (const line of lines) {
      if (line.startsWith("#")) {
        if (line.startsWith("#EXT-X-KEY:")) {
          const match = line.match(/https?:\/\/[^\s"']+/);
          if (match) {
            const keyUrl = match[0];
            const proxied = "/ts-proxy?url=" + encodeURIComponent(keyUrl);
            newLines.push(line.replace(keyUrl, proxied));
          } else {
            newLines.push(line);
          }
        } else {
          newLines.push(line);
        }
      } else if (line.trim()) {
        const abs = new URL(line, targetUrl).href;
        const isM3U8 = abs.endsWith(".m3u8");
        const endpoint = isM3U8 ? "/m3u8-proxy" : "/ts-proxy";
        const proxied = \`\${endpoint}?url=\${encodeURIComponent(abs)}\`;
        newLines.push(proxied);
      }
    }

    return new Response(newLines.join("\n"), {
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}

async function handleTsProxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return new Response("URL is required", { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Referer": targetUrl,
        "Origin": new URL(targetUrl).origin,
      },
    });

    if (!response.ok) {
      return new Response("Failed to fetch segment", { status: response.status });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "video/mp2t",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  } catch (return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": "video/mp2t",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}
