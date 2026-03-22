import fs from "node:fs/promises";
import path from "node:path";

const defaultSiteUrl = "https://restaurantketo2009.netlify.app";
const siteUrl = (process.argv[2] || process.env.NETLIFY_SITE_URL || defaultSiteUrl).replace(/\/$/, "");
const reportPath = path.join("d:\\flutter2\\system delivery", ".codex-run", "netlify-login-report.json");

const defaultHeaders = {
  Accept: "application/json, text/plain, */*"
};

const summarizeBody = (body) => {
  if (typeof body !== "string") {
    return "";
  }

  return body.replace(/\s+/g, " ").trim().slice(0, 280);
};

const request = async (target, init = {}) => {
  try {
    const response = await fetch(target, {
      redirect: "manual",
      ...init,
      headers: {
        ...defaultHeaders,
        ...(init.headers || {})
      }
    });

    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    let json = null;

    if (contentType.includes("application/json")) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }

    return {
      url: target,
      ok: response.ok,
      status: response.status,
      contentType,
      json,
      bodyPreview: summarizeBody(text)
    };
  } catch (error) {
    return {
      url: target,
      ok: false,
      status: 0,
      contentType: "",
      json: null,
      bodyPreview: error instanceof Error ? error.message : String(error)
    };
  }
};

const inferIssues = (checks) => {
  const issues = [];
  const proxiedReady = checks.proxiedReady;
  const directReady = checks.directReady;
  const proxiedLogin = checks.proxiedLogin;
  const directLogin = checks.directLogin;

  const directFunctionHealthy =
    directReady.status === 200 &&
    directReady.json?.success === true &&
    directReady.json?.data?.status === "ready";

  const proxiedLooksLikeSpaHtml =
    proxiedReady.status === 200 &&
    proxiedReady.contentType.includes("text/html");

  if (directFunctionHealthy && proxiedLooksLikeSpaHtml) {
    issues.push({
      code: "api_rewrite_shadowed_by_spa_redirect",
      severity: "high",
      message: "The Netlify Function is healthy on /.netlify/functions/api/*, but /api/* is being served by index.html instead of being rewritten to the function.",
      likelyFiles: [
        "apps/web/public/_redirects",
        "netlify.toml"
      ],
      recommendedFix: "Ensure /api/* -> /.netlify/functions/api/:splat appears before the SPA catch-all redirect, and keep force = true on the Netlify redirect."
    });
  }

  if (directFunctionHealthy && proxiedLogin.status === 404) {
    issues.push({
      code: "login_api_route_not_reaching_function",
      severity: "high",
      message: "POST /api/auth/login-pin returns 404 while the direct function path is deployed and reachable.",
      likelyFiles: [
        "apps/web/public/_redirects",
        "netlify.toml"
      ],
      recommendedFix: "Publish a redirect file that includes the /api/* function rewrite and redeploy Netlify."
    });
  }

  if (directLogin.status >= 500 || proxiedLogin.status >= 500) {
    issues.push({
      code: "function_runtime_failure",
      severity: "high",
      message: "The login function returned a 5xx response, which points to a runtime or storage initialization error inside the serverless function.",
      likelyFiles: [
        "netlify/functions/api.ts",
        "package.json",
        "netlify.toml"
      ],
      recommendedFix: "Inspect the deployed function logs and confirm Netlify Functions can resolve @netlify/blobs and initialize the persistence layer."
    });
  }

  if (
    directLogin.status === 200 &&
    directLogin.json?.success === true &&
    proxiedLogin.status === 200 &&
    proxiedLogin.json?.success === true
  ) {
    issues.push({
      code: "no_issue_detected",
      severity: "info",
      message: "The production login flow is healthy through both the direct function path and the /api rewrite.",
      likelyFiles: [],
      recommendedFix: ""
    });
  }

  return issues;
};

const main = async () => {
  const checks = {
    proxiedReady: await request(`${siteUrl}/api/readyz`),
    directReady: await request(`${siteUrl}/.netlify/functions/api/readyz`),
    proxiedLogin: await request(`${siteUrl}/api/auth/login-pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "9900", rememberMe: true })
    }),
    directLogin: await request(`${siteUrl}/.netlify/functions/api/auth/login-pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "9900", rememberMe: true })
    })
  };

  const issues = inferIssues(checks);
  const report = {
    generatedAt: new Date().toISOString(),
    siteUrl,
    checks,
    issues
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(JSON.stringify(report, null, 2));

  const actionableIssues = issues.filter((issue) => issue.severity !== "info");
  if (actionableIssues.length > 0) {
    process.exitCode = 1;
  }
};

await main();
