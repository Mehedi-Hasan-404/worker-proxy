const ALLOWED_ORIGINS = ["*"];

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);

  if (url.pathname === "/m3u8-proxy") {
    return handleM3U8Proxy(request);
  } else if (url.pathname === "/ts-proxy") {
    return handleTsProxy(request);
  }

  return new Response("M3U8 Proxy Worker is active!", { status: 200 });
}

const options = {
  originBlacklist: [], // optional: ["https://spam.com"]
  originWhitelist: ["*"], // or your domain(s)
};

async function handleM3U8Proxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const headers = JSON.parse(searchParams.get("headers") || "{}");

  if (!targetUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  const res = await fetch(targetUrl, { headers });
  let m3u8 = await res.text();

  // Remove audio lines
  m3u8 = m3u8
    .split("\n")
    .filter((line) => !line.startsWith("#EXT-X-MEDIA:TYPE=AUDIO"))
    .join("\n");

  // Rewrite internal links
  const newLines = [];
  for (const line of m3u8.split("\n")) {
    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-KEY:")) {
        const match = line.match(/https?:\/\/[^\s"']+/);
        if (match) {
          const keyUrl = match[0];
          const proxied = `/ts-proxy?url=${encodeURIComponent(
            keyUrl
          )}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
          newLines.push(line.replace(keyUrl, proxied));
        } else newLines.push(line);
      } else newLines.push(line);
    } else if (line.trim()) {
      const abs = new URL(line, targetUrl).href;
      const proxied = `/ts-proxy?url=${encodeURIComponent(
        abs
      )}&headers=${encodeURIComponent(JSON.stringify(headers))}`;
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
}

async function handleTsProxy(request) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url");
  const headers = JSON.parse(searchParams.get("headers") || "{}");

  if (!targetUrl) {
    return new Response("Missing url parameter", { status: 400 });
  }

  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      ...headers,
    },
  });

  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": "video/mp2t",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}
