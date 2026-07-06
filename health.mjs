function toTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : 0;
}

function latencyOf(result) {
  const value = result?.totalMs ?? result?.firstTokenMs ?? result?.headersMs;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function rounded(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value / 10) * 10;
}

function median(sortedValues) {
  if (!sortedValues.length) {
    return null;
  }

  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 1) {
    return sortedValues[middle];
  }

  return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function nearestRankPercentile(sortedValues, ratio) {
  if (!sortedValues.length) {
    return null;
  }
  const clamped = Math.min(1, Math.max(0, ratio));
  const rank = Math.ceil(sortedValues.length * clamped);
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, rank - 1))];
}

function consecutiveFailures(sortedResults) {
  let count = 0;
  for (let index = sortedResults.length - 1; index >= 0; index -= 1) {
    if (sortedResults[index]?.ok) {
      break;
    }
    count += 1;
  }
  return count;
}

export function calculateHealth(results, options = {}) {
  const sortedResults = [...(results || [])].sort((a, b) => (
    toTime(a.finishedAt || a.recordedAt) - toTime(b.finishedAt || b.recordedAt)
  ));
  const sampleCount = sortedResults.length;

  if (sampleCount === 0) {
    return {
      status: "unknown",
      sampleCount: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      averageMs: null,
      maxMs: null,
      jitterMs: null,
      lastCheckedAt: "",
      lastError: "",
    };
  }

  const successResults = sortedResults.filter((result) => result.ok);
  const failureResults = sortedResults.filter((result) => !result.ok);
  const latencies = successResults
    .map(latencyOf)
    .filter((value) => value !== null);
  const successCount = successResults.length;
  const failureCount = failureResults.length;
  const successRate = Number((successCount / sampleCount).toFixed(3));
  const averageRaw = latencies.length
    ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
    : null;
  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const maxRaw = latencies.length ? Math.max(...latencies) : null;
  const minRaw = latencies.length ? Math.min(...latencies) : null;
  const jitterRaw = maxRaw !== null && minRaw !== null ? maxRaw - minRaw : null;
  const medianRaw = median(sortedLatencies);
  const p95Raw = nearestRankPercentile(sortedLatencies, 0.95);
  const recentFailureCount = consecutiveFailures(sortedResults);
  const lastResult = sortedResults.at(-1);
  const lastFailure = [...failureResults].reverse()[0];
  const averageMs = rounded(averageRaw);
  const maxMs = rounded(maxRaw);
  const jitterMs = rounded(jitterRaw);
  const medianMs = rounded(medianRaw);
  const p95Ms = rounded(p95Raw);
  const jitterLimitRatio = Number(options.jitterLimitRatio ?? 0.75);

  let status = "stable";
  if (successCount === 0 || recentFailureCount >= 3 || successRate < 0.5) {
    status = "down";
  } else if (
    failureCount > 0 ||
    successRate < 0.95 ||
    (averageRaw && jitterRaw !== null && jitterRaw > averageRaw * jitterLimitRatio)
  ) {
    status = "unstable";
  }

  return {
    status,
    sampleCount,
    successCount,
    failureCount,
    successRate,
    averageMs,
    maxMs,
    medianMs,
    p95Ms,
    jitterMs,
    lastCheckedAt: lastResult?.finishedAt || lastResult?.recordedAt || "",
    lastError: lastFailure?.error || lastFailure?.bodyText || "",
  };
}
