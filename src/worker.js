addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

const options = {
  originBlacklist: ["*"], // Replace with specific origins if needed
  originWhitelist: [],    // Add allowed origins if applicable
};

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/m3u8-proxy") {
    return handleM3U8Proxy(request);
  } else if (url.pathname === "/ts-proxy") {
    return handleTsProxy(request);
  }

  return new Response("Not Found", { status: 404 });
}

async function handleM3U8Proxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const headers = JSON.parse(searchParams.get("headers") || "{}");
  const origin = request.headers.get("Origin") || "";

  if (
    options.originBlacklist.includes("*") &&
    !options.originWhitelist.includes(origin)
  ) {
    return new Response(`The origin "${origin}" was blacklisted.`, { status: 403 });
  }

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
      .filter((line) => !line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO"))
      .join("\n");

    const lines = m3u8.split("\n");
    const newLines = [];

    for (const line of lines) {
      if (line.startsWith("#")) {
        if (line.startsWith("#EXT-X-KEY:")) {
          const match = line.match(/https?:\/\/[^\s"']+/);
          if (match) {
            const keyUrl = match[0];
            const proxied = `/ts-proxy?url=${encodeURIComponent(keyUrl)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
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
        const proxied = `${endpoint}?url=${encodeURIComponent(abs)}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
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
  const headers = JSON.parse(searchParams.get("headers") || "{}");
  const origin = request.headers.get("Origin") || "";

  if (
    options.originBlacklist.includes("*") &&
    !options.originWhitelist.includes(origin)
  ) {
    return new Response(`The origin "${origin}" was blacklisted.`, { status: 403 });
  }

  if (!targetUrl) {
    return new Response("URL is required", { status: 400 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        ...headers,
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
  } catch (error) {
    return new Response(error.message, { status: 500 });
  }
}
