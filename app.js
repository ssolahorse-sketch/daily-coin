const metrics = [
  { key: "btcRsi", title: "비트코인 RSI", icon: "BR", kind: "rsi", dataMode: "historical" },
  { key: "ethRsi", title: "이더리움 RSI", icon: "ER", kind: "rsi", dataMode: "historical" },
  { key: "xrpRsi", title: "리플 RSI", icon: "XR", kind: "rsi", dataMode: "historical" },
  { key: "solRsi", title: "솔라나 RSI", icon: "SR", kind: "rsi", dataMode: "historical" },
  { key: "btcDominance", title: "비트코인 도미넌스", icon: "B", kind: "inverse", dataMode: "current" },
  { key: "fearGreed", title: "공포탐욕지수", icon: "FG", kind: "sentiment", dataMode: "historical" },
  { key: "altSeason", title: "알트시즌 인덱스", icon: "A", kind: "sentiment", dataMode: "historical" },
  { key: "coinbaseRank", title: "코인베이스 앱 순위", icon: "#", kind: "rank", dataMode: "current" },
  { key: "kimchiPremium", title: "김치프리미엄", icon: "K", kind: "premium", dataMode: "current" },
  { key: "mvrvz", title: "MVRV Z-Score", icon: "Z", kind: "mvrv", dataMode: "limited" },
  { key: "ism", title: "ISM 제조업지수", icon: "I", kind: "ism", dataMode: "release" },
  { key: "globalM2", title: "Global M2", icon: "M2", kind: "neutral", dataMode: "current" },
  { key: "dxy", title: "DXY", icon: "$", kind: "dxy", dataMode: "historical" },
  { key: "fundingRate", title: "펀딩비", icon: "F", kind: "funding", dataMode: "current" }
];

const zoomWindows = [Infinity, 365, 120, 30];
const visibleDotCount = 18;

const state = {
  data: null,
  days: [],
  index: 0,
  view: "dashboard",
  chartMetric: null,
  chartOriginIndex: 0,
  chartData: [],
  chartSelectedIndex: 0,
  chartZoom: 0,
  chartWindowStart: 0,
  scoreOriginIndex: 0
};

const scoreWeights = {
  rsi: 14,
  fearGreed: 16,
  altSeason: 8,
  dxy: 10,
  fundingRate: 8,
  kimchiPremium: 6
};

const splash = document.querySelector("#splash");
const app = document.querySelector("#app");
const slides = document.querySelector("#slides");
const dots = document.querySelector("#dots");
const dateLabel = document.querySelector("#dateLabel");
const updatedLabel = document.querySelector("#updatedLabel");
const prevBtn = document.querySelector("#prevBtn");
const nextBtn = document.querySelector("#nextBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const insightPanel = document.querySelector("#insightPanel");
const marketScore = document.querySelector("#marketScore");
const marketRegime = document.querySelector("#marketRegime");
const signalList = document.querySelector("#signalList");
const dailyReport = document.querySelector("#dailyReport");
const chartPanel = document.querySelector("#chartPanel");
const chartKicker = document.querySelector("#chartKicker");
const chartTitle = document.querySelector("#chartTitle");
const chartBody = document.querySelector("#chartBody");
const chartClose = document.querySelector("#chartClose");
let chartDrag = null;
let chartTouch = null;
const activeChartPointers = new Map();
let slideSettleTimer = null;

function formatDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${date}T00:00:00Z`));
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date(`${date}T00:00:00Z`));
}

function compactDate(date) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function compactYearDate(date) {
  const [year, month, day] = date.split("-");
  return `${year.slice(2)}.${Number(month)}/${Number(day)}`;
}

function tone(metric, point) {
  if (!point || point.value === null) return "";
  const v = point.value;
  if (metric.kind === "sentiment") {
    if (v >= 75) return "tone-good";
    if (v <= 25) return "tone-bad";
    return "tone-warn";
  }
  if (metric.kind === "rank") return v <= 25 ? "tone-good" : v <= 100 ? "tone-warn" : "tone-bad";
  if (metric.kind === "ism") return v >= 50 ? "tone-good" : "tone-bad";
  if (metric.kind === "mvrv") return v >= 4 ? "tone-bad" : v <= 1 ? "tone-good" : "tone-warn";
  if (metric.kind === "dxy") return v >= 105 ? "tone-bad" : v <= 100 ? "tone-good" : "tone-warn";
  if (metric.kind === "premium") return Math.abs(v) <= 1 ? "tone-good" : Math.abs(v) <= 3 ? "tone-warn" : "tone-bad";
  if (metric.kind === "funding") return Math.abs(v) <= 0.01 ? "tone-good" : Math.abs(v) <= 0.05 ? "tone-warn" : "tone-bad";
  if (metric.kind === "rsi") return v >= 70 ? "tone-bad" : v <= 30 ? "tone-good" : "tone-warn";
  return "";
}

function valueOf(day, key) {
  const value = day?.values?.[key]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function calculateMarketSignal(day) {
  const btcRsi = valueOf(day, "btcRsi");
  const ethRsi = valueOf(day, "ethRsi");
  const xrpRsi = valueOf(day, "xrpRsi");
  const solRsi = valueOf(day, "solRsi");
  const fear = valueOf(day, "fearGreed");
  const alt = valueOf(day, "altSeason");
  const dxy = valueOf(day, "dxy");
  const funding = valueOf(day, "fundingRate");
  const kimchi = valueOf(day, "kimchiPremium");
  const rsiValues = [btcRsi, ethRsi, xrpRsi, solRsi].filter((value) => value !== null);
  const avgRsi = rsiValues.length ? rsiValues.reduce((sum, value) => sum + value, 0) / rsiValues.length : null;

  let score = 50;
  const signals = [];
  const contributions = [];

  if (avgRsi !== null) {
    const delta = avgRsi < 35 ? 14 : avgRsi > 70 ? -14 : avgRsi < 45 ? 6 : avgRsi > 60 ? -6 : 0;
    score += delta;
    contributions.push({ key: "rsi", title: "RSI 4종 평균", value: avgRsi.toFixed(1), delta, max: scoreWeights.rsi });
    if (avgRsi < 35) signals.push({ tone: "good", text: "RSI 과매도권" });
    if (avgRsi > 70) signals.push({ tone: "bad", text: "RSI 과열권" });
  }
  if (fear !== null) {
    const delta = fear <= 25 ? 16 : fear >= 75 ? -16 : fear < 40 ? 6 : fear > 60 ? -6 : 0;
    score += delta;
    contributions.push({ key: "fearGreed", title: "공포탐욕지수", value: fear.toFixed(0), delta, max: scoreWeights.fearGreed });
    if (fear <= 25) signals.push({ tone: "good", text: "극단 공포" });
    if (fear >= 75) signals.push({ tone: "bad", text: "극단 탐욕" });
  }
  if (alt !== null) {
    const delta = alt >= 75 ? -8 : alt <= 25 ? 5 : 0;
    score += delta;
    contributions.push({ key: "altSeason", title: "알트시즌 인덱스", value: alt.toFixed(0), delta, max: scoreWeights.altSeason });
    if (alt >= 75) signals.push({ tone: "bad", text: "알트시즌 과열" });
    if (alt <= 25) signals.push({ tone: "warn", text: "비트코인 시즌" });
  }
  if (dxy !== null) {
    const delta = dxy >= 105 ? -10 : dxy <= 100 ? 7 : 0;
    score += delta;
    contributions.push({ key: "dxy", title: "DXY", value: dxy.toFixed(2), delta, max: scoreWeights.dxy });
    if (dxy >= 105) signals.push({ tone: "bad", text: "DXY 강세" });
    if (dxy <= 100) signals.push({ tone: "good", text: "DXY 완화" });
  }
  if (funding !== null) {
    const delta = Math.abs(funding) <= 0.01 ? 3 : funding > 0.05 ? -8 : funding < -0.03 ? 5 : 0;
    score += delta;
    contributions.push({ key: "fundingRate", title: "펀딩비", value: `${funding.toFixed(4)}%`, delta, max: scoreWeights.fundingRate });
    if (funding > 0.05) signals.push({ tone: "bad", text: "펀딩비 과열" });
    if (funding < -0.03) signals.push({ tone: "good", text: "숏 우위" });
  }
  if (kimchi !== null) {
    const delta = Math.abs(kimchi) <= 1 ? 2 : kimchi > 3 ? -6 : kimchi < -1 ? 3 : 0;
    score += delta;
    contributions.push({ key: "kimchiPremium", title: "김치프리미엄", value: `${kimchi.toFixed(2)}%`, delta, max: scoreWeights.kimchiPremium });
    if (kimchi > 3) signals.push({ tone: "bad", text: "김프 과열" });
    if (kimchi < -1) signals.push({ tone: "good", text: "역프리미엄" });
  }

  score = Math.round(clamp(score, 0, 100));
  const regime = score >= 70 ? "기회 우위" : score >= 55 ? "완만한 기회" : score >= 45 ? "중립" : score >= 30 ? "주의" : "위험";
  if (!signals.length) signals.push({ tone: "neutral", text: "특이 신호 없음" });
  const totalWeight = contributions.reduce((sum, item) => sum + item.max, 0);
  const ranked = [...contributions].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { score, regime, signals: signals.slice(0, 5), avgRsi, fear, dxy, contributions, ranked, totalWeight };
}

function updateInsights() {
  if (!state.days.length) return;
  const day = state.days[state.index];
  const signal = calculateMarketSignal(day);
  marketScore.textContent = signal.score;
  marketRegime.textContent = signal.regime;
  signalList.innerHTML = signal.signals.map((item) => `<span class="signal-chip ${item.tone}">${item.text}</span>`).join("");
  const rsiText = signal.avgRsi === null ? "RSI 데이터 부족" : `평균 RSI ${signal.avgRsi.toFixed(1)}`;
  const fearText = signal.fear === null ? "공포탐욕 없음" : `공포탐욕 ${signal.fear.toFixed(0)}`;
  const dxyText = signal.dxy === null ? "DXY 없음" : `DXY ${signal.dxy.toFixed(2)}`;
  dailyReport.textContent = `${rsiText} · ${fearText} · ${dxyText}. 오늘은 ${signal.regime} 구간입니다.`;
  insightPanel.dataset.signal = JSON.stringify(signal);
}

function metricStatusTag(metric, point) {
  if (!point || typeof point.value !== "number" || !Number.isFinite(point.value)) return null;
  const v = point.value;

  if (metric.key === "fearGreed") {
    if (v <= 25) return { tone: "good", text: "극단 공포" };
    if (v >= 75) return { tone: "bad", text: "극단 탐욕" };
    if (v < 40) return { tone: "good", text: "공포" };
    if (v > 60) return { tone: "bad", text: "탐욕" };
    return { tone: "warn", text: "중립" };
  }

  if (metric.key === "altSeason") {
    if (v >= 75) return { tone: "bad", text: "알트시즌" };
    if (v <= 25) return { tone: "warn", text: "비트코인 시즌" };
    return { tone: "warn", text: "중립" };
  }

  if (metric.kind === "rsi") {
    if (v <= 30) return { tone: "good", text: "과매도" };
    if (v >= 70) return { tone: "bad", text: "과열" };
    return null;
  }

  if (metric.key === "dxy") {
    if (v >= 105) return { tone: "bad", text: "달러 강세" };
    if (v <= 100) return { tone: "good", text: "달러 완화" };
    return null;
  }

  if (metric.key === "kimchiPremium") {
    if (v > 3) return { tone: "bad", text: "김프 과열" };
    if (v < -1) return { tone: "good", text: "역프리미엄" };
    return null;
  }

  if (metric.key === "fundingRate") {
    if (v > 0.05) return { tone: "bad", text: "롱 과열" };
    if (v < -0.03) return { tone: "good", text: "숏 우위" };
    return null;
  }

  if (metric.key === "mvrvz") {
    if (v >= 4) return { tone: "bad", text: "고평가" };
    if (v <= 1) return { tone: "good", text: "저평가" };
    return null;
  }

  if (metric.key === "ism") {
    return v >= 50 ? { tone: "good", text: "확장" } : { tone: "bad", text: "위축" };
  }

  if (metric.key === "coinbaseRank") {
    if (v <= 25) return { tone: "bad", text: "관심 과열" };
    if (v > 100) return { tone: "good", text: "관심 낮음" };
    return null;
  }

  return null;
}

function metricCard(metric, point, sources) {
  const label = point?.label || "데이터 없음";
  const dataModeLabel = {
    historical: "날짜별 데이터",
    current: "현재값 기준",
    release: "최신 발표값 기준",
    limited: "제한된 히스토리"
  }[metric.dataMode] || "데이터 기준";
  const meta = point?.error ? point.error : dataModeLabel;
  const hasChart = ["historical", "limited"].includes(metric.dataMode);
  const statusTag = metricStatusTag(metric, point);
  return `
    <article class="metric-card ${tone(metric, point)}" data-metric="${metric.key}" role="button" tabindex="0" aria-label="${metric.title} 차트 보기">
      <div class="metric-head">
        <p class="metric-title">${metric.title}</p>
        <span class="metric-icons">
          <span class="metric-icon-row">
          ${hasChart ? `<span class="chart-badge" title="차트 가능" aria-label="차트 가능">⌁</span>` : ""}
          <span class="metric-icon">${metric.icon}</span>
          </span>
          ${statusTag ? `<span class="metric-tag ${statusTag.tone}">${statusTag.text}</span>` : ""}
        </span>
      </div>
      <p class="metric-value">${label}</p>
      <p class="metric-meta">${meta}</p>
      <p class="metric-source">${sources[metric.key] || ""}</p>
    </article>
  `;
}

function metricSeries(metricKey) {
  const rows = state.data?.chartHistory?.[metricKey] || [];
  if (rows.length) {
    return rows
      .filter((point) => typeof point.value === "number" && Number.isFinite(point.value))
      .map((point) => ({ ...point, label: point.label || point.value.toFixed(2) }));
  }
  return state.days
    .map((day) => {
      const point = day.values[metricKey];
      return {
        date: day.date,
        label: point?.label || "",
        value: typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null
      };
    })
    .filter((point) => point.value !== null);
}

function nearestIndexByDate(series, date) {
  let best = 0;
  let bestDistance = Infinity;
  const target = new Date(`${date}T00:00:00Z`).getTime();
  series.forEach((point, index) => {
    const distance = Math.abs(new Date(`${point.date}T00:00:00Z`).getTime() - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function visibleChartSeries() {
  const size = zoomWindows[state.chartZoom];
  if (!Number.isFinite(size) || state.chartData.length <= size) {
    state.chartWindowStart = 0;
    return { series: state.chartData, offset: 0 };
  }
  const maxStart = Math.max(0, state.chartData.length - size);
  let start = Math.max(0, Math.min(state.chartWindowStart, maxStart));
  state.chartWindowStart = start;
  return { series: state.chartData.slice(start, start + size), offset: start };
}

function setChartSelection(index) {
  state.chartSelectedIndex = Math.max(0, Math.min(index, state.chartData.length - 1));
  updateChrome();
  renderChart();
}

function centerChartWindow() {
  const size = zoomWindows[state.chartZoom];
  if (!Number.isFinite(size) || state.chartData.length <= size) {
    state.chartWindowStart = 0;
    return;
  }
  const maxStart = Math.max(0, state.chartData.length - size);
  state.chartWindowStart = Math.max(0, Math.min(state.chartSelectedIndex - Math.floor(size / 2), maxStart));
}

function changeZoom(delta, anchorIndex = state.chartSelectedIndex) {
  const currentWindow = visibleChartSeries();
  let nextZoom = state.chartZoom;
  do {
    nextZoom = Math.max(0, Math.min(nextZoom + delta, zoomWindows.length - 1));
    const size = zoomWindows[nextZoom];
    const changesVisibleRange = !Number.isFinite(size) || state.chartData.length > size;
    if (changesVisibleRange || nextZoom === 0 || nextZoom === zoomWindows.length - 1) break;
  } while (nextZoom > 0 && nextZoom < zoomWindows.length - 1);
  if (nextZoom === state.chartZoom) return;
  state.chartZoom = nextZoom;
  anchorIndex = Math.max(0, Math.min(anchorIndex, state.chartData.length - 1));
  const size = zoomWindows[state.chartZoom];
  if (Number.isFinite(size) && state.chartData.length > size) {
    const visibleCount = Math.max(currentWindow.series.length - 1, 1);
    const visibleRatio = Math.max(0, Math.min(1, (anchorIndex - currentWindow.offset) / visibleCount));
    const desiredStart = Math.round(anchorIndex - visibleRatio * size);
    const maxStart = Math.max(0, state.chartData.length - size);
    state.chartWindowStart = Math.max(0, Math.min(desiredStart, maxStart));
  } else {
    state.chartWindowStart = 0;
  }
  updateChrome();
  renderChart();
}

function panChartByPixels(dx, plotWidth, visibleCount, startWindow) {
  if (!Number.isFinite(zoomWindows[state.chartZoom])) return false;
  const step = Math.round((-dx / Math.max(plotWidth, 1)) * visibleCount);
  const maxStart = Math.max(0, state.chartData.length - zoomWindows[state.chartZoom]);
  const nextStart = Math.max(0, Math.min(startWindow + step, maxStart));
  if (nextStart === state.chartWindowStart) return false;
  state.chartWindowStart = nextStart;
  renderChart();
  return true;
}

function renderChart() {
  const metric = metrics.find((item) => item.key === state.chartMetric);
  chartPanel.hidden = false;
  chartTitle.textContent = metric.title;

  if (state.chartData.length < 2) {
    const selected = state.chartData[0];
    chartKicker.textContent = selected ? compactDate(selected.date) : "History";
    chartBody.innerHTML = `<p class="chart-empty">이 지표는 차트로 볼 날짜별 값이 아직 부족합니다.</p>`;
    return;
  }

  const { series, offset } = visibleChartSeries();
  const selected = state.chartData[state.chartSelectedIndex];
  const selectedInView = state.chartSelectedIndex >= offset && state.chartSelectedIndex < offset + series.length;
  const localSelectedIndex = state.chartSelectedIndex - offset;
  const width = 720;
  const height = 300;
  const pad = { top: 26, right: 24, bottom: 42, left: 48 };
  const values = series.map((point) => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;
  const x = (index) => pad.left + (index / Math.max(series.length - 1, 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + ((max - value) / (max - min)) * (height - pad.top - pad.bottom);
  const line = series.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`).join(" ");
  const selectedX = selectedInView ? x(localSelectedIndex) : null;
  const selectedY = selectedInView ? y(selected.value) : null;
  const windowLabel = Number.isFinite(zoomWindows[state.chartZoom]) ? `${zoomWindows[state.chartZoom]}일` : "전체";
  const step = series.length > 1 ? (width - pad.left - pad.right) / (series.length - 1) : 8;

  chartKicker.textContent = `${compactYearDate(series[0].date)} - ${compactYearDate(series[series.length - 1].date)} · ${windowLabel}`;
  chartBody.innerHTML = `
    <div class="chart-tools">
      <div class="chart-value-row">
        <span>${compactYearDate(selected.date)}</span>
        <strong>${selected.label || selected.value.toFixed(2)}</strong>
      </div>
    </div>
    <svg id="metricChart" class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${metric.title} 차트">
      <rect class="chart-hitbox" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${height - pad.top - pad.bottom}"></rect>
      <line class="chart-grid" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}"></line>
      <line class="chart-grid" x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}"></line>
      <text class="chart-axis" x="${pad.left - 8}" y="${pad.top + 4}" text-anchor="end">${max.toFixed(2)}</text>
      <text class="chart-axis" x="${pad.left - 8}" y="${height - pad.bottom + 4}" text-anchor="end">${min.toFixed(2)}</text>
      <path class="chart-line" d="${line}"></path>
      ${selectedInView ? `
        <line class="chart-marker-line" x1="${selectedX.toFixed(1)}" y1="${pad.top}" x2="${selectedX.toFixed(1)}" y2="${height - pad.bottom}"></line>
        <circle class="chart-marker" cx="${selectedX.toFixed(1)}" cy="${selectedY.toFixed(1)}" r="8"></circle>
      ` : ""}
      <text class="chart-axis" x="${pad.left}" y="${height - 12}" text-anchor="start">${compactYearDate(series[0].date)}</text>
      ${selectedInView ? `<text class="chart-axis" x="${selectedX.toFixed(1)}" y="${height - 12}" text-anchor="middle">${compactYearDate(selected.date)}</text>` : ""}
      <text class="chart-axis" x="${width - pad.right}" y="${height - 12}" text-anchor="end">${compactYearDate(series[series.length - 1].date)}</text>
    </svg>
  `;

  const chartSvg = document.querySelector("#metricChart");
  const anchorFromClientX = (clientX) => {
    const rect = chartSvg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (((clientX - rect.left) / rect.width) * width - pad.left) / (width - pad.left - pad.right)));
    return offset + Math.round(ratio * (series.length - 1));
  };
  const pickFromChart = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const chartX = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (chartX - pad.left) / (width - pad.left - pad.right);
    const localIndex = Math.round(Math.max(0, Math.min(1, ratio)) * (series.length - 1));
    activeChartPointers.clear();
    chartDrag = null;
    setChartSelection(offset + localIndex);
  };
  chartSvg?.addEventListener("wheel", (event) => {
    event.preventDefault();
    const anchorIndex = anchorFromClientX(event.clientX);
    changeZoom(event.deltaY < 0 ? 1 : -1, anchorIndex);
  }, { passive: false });
  chartSvg?.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch" && event.isPrimary) {
      activeChartPointers.clear();
      chartTouch = null;
    }
    if (event.pointerType !== "touch") {
      activeChartPointers.clear();
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activeChartPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    chartDrag = {
      x: event.clientX,
      y: event.clientY,
      startWindow: state.chartWindowStart,
      moved: false,
      pinching: false,
      pinchDistance: 0
    };
  });
  chartSvg?.addEventListener("pointermove", (event) => {
    if (!chartDrag) return;
    activeChartPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...activeChartPointers.values()];
    if (pointers.length >= 2) {
      const distance = Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
      if (!chartDrag.pinching) {
        chartDrag.pinching = true;
        chartDrag.pinchDistance = distance;
        return;
      }
      if (Math.abs(distance - chartDrag.pinchDistance) > 28) {
        const midpointX = (pointers[0].x + pointers[1].x) / 2;
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (((midpointX - rect.left) / rect.width) * width - pad.left) / (width - pad.left - pad.right)));
        const anchorIndex = offset + Math.round(ratio * (series.length - 1));
        changeZoom(distance > chartDrag.pinchDistance ? 1 : -1, anchorIndex);
        chartDrag.pinchDistance = distance;
      }
      chartDrag.moved = true;
      return;
    }
    if (event.pointerType === "touch") {
      chartDrag.pinching = false;
    }
    const dx = event.clientX - chartDrag.x;
    if (Math.abs(dx) > 4) chartDrag.moved = true;
    panChartByPixels(dx, width - pad.left - pad.right, series.length, chartDrag.startWindow);
  });
  const endPointer = (event) => {
    const endedPointer = activeChartPointers.get(event.pointerId);
    activeChartPointers.delete(event.pointerId);
    if (chartDrag && !chartDrag.moved && !chartDrag.pinching && endedPointer) {
      pickFromChart(event);
    }
    if (activeChartPointers.size === 0) chartDrag = null;
  };
  chartSvg?.addEventListener("pointerup", endPointer);
  chartSvg?.addEventListener("pointercancel", endPointer);
  chartSvg?.addEventListener("touchstart", (event) => {
    if (event.touches.length < 2) {
      chartTouch = null;
      return;
    }
    if (event.touches.length === 2) {
      event.preventDefault();
      const [a, b] = event.touches;
      chartTouch = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        midpointX: (a.clientX + b.clientX) / 2
      };
    }
  }, { passive: false });
  chartSvg?.addEventListener("touchmove", (event) => {
    if (!chartTouch || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = event.touches;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (Math.abs(distance - chartTouch.distance) < 22) return;
    const midpointX = (a.clientX + b.clientX) / 2;
    changeZoom(distance > chartTouch.distance ? 1 : -1, anchorFromClientX(midpointX));
    chartTouch = { distance, midpointX };
  }, { passive: false });
  chartSvg?.addEventListener("touchend", (event) => {
    if (event.touches.length < 2) chartTouch = null;
  });
}

function enterChart(metricKey) {
  const selectedDashboardDate = state.days[state.index].date;
  state.view = "chart";
  state.chartMetric = metricKey;
  state.chartOriginIndex = state.index;
  state.chartZoom = 0;
  state.chartData = metricSeries(metricKey);
  state.chartSelectedIndex = nearestIndexByDate(state.chartData, selectedDashboardDate);
  centerChartWindow();
  slides.hidden = true;
  dots.hidden = true;
  insightPanel.hidden = true;
  updateChrome();
  renderChart();
}

function exitChart() {
  const returnIndex = state.chartOriginIndex;
  state.view = "dashboard";
  state.chartMetric = null;
  state.chartData = [];
  chartPanel.hidden = true;
  slides.hidden = false;
  dots.hidden = false;
  insightPanel.hidden = false;
  goTo(returnIndex, false);
}

function closeDetailView() {
  const returnIndex = state.scoreOriginIndex;
  state.view = "dashboard";
  chartPanel.hidden = true;
  slides.hidden = false;
  dots.hidden = false;
  insightPanel.hidden = false;
  goTo(returnIndex, false);
}

function refreshScoreDetail() {
  if (state.view !== "score") return;
  const day = state.days[state.index];
  const signal = calculateMarketSignal(day);
  chartKicker.textContent = `${formatDate(day.date)} · 점수 산출 내역`;
  chartTitle.textContent = "Daily Signal";
  const rows = signal.contributions.map((item) => {
    const share = signal.totalWeight ? Math.round((item.max / signal.totalWeight) * 100) : 0;
    const impact = item.delta > 0 ? `+${item.delta}` : `${item.delta}`;
    const barWidth = Math.round((Math.abs(item.delta) / item.max) * 100);
    return `
      <div class="score-detail-row">
        <div>
          <strong>${item.title}</strong>
          <span>값 ${item.value} · 최대 반영 ${share}%</span>
        </div>
        <div class="impact ${item.delta >= 0 ? "plus" : "minus"}">${impact}</div>
        <div class="impact-bar"><span style="width:${barWidth}%"></span></div>
      </div>
    `;
  }).join("");
  const leaders = signal.ranked.slice(0, 3).map((item) => `${item.title} ${item.delta > 0 ? "+" : ""}${item.delta}`).join(" · ");
  chartBody.innerHTML = `
    <div class="score-detail-summary">
      <div class="score-big">${signal.score}</div>
      <div>
        <p class="eyebrow">현재 판단</p>
        <h4>${signal.regime}</h4>
        <p>가장 크게 작용한 항목: ${leaders || "없음"}</p>
      </div>
    </div>
    <div class="score-detail-list">${rows}</div>
    <p class="score-detail-note">비트코인 도미넌스, 코인베이스 앱 순위, MVRV Z-Score, ISM 제조업지수, Global M2는 현재 점수 산식에는 직접 반영하지 않습니다.</p>
  `;
}

function openScoreDetail() {
  if (!state.days.length) return;
  const day = state.days[state.index];
  const signal = calculateMarketSignal(day);
  state.view = "score";
  state.scoreOriginIndex = state.index;
  slides.hidden = true;
  dots.hidden = true;
  insightPanel.hidden = true;
  chartPanel.hidden = false;
  updateChrome();
  refreshScoreDetail();
}

function render() {
  if (!state.data) return;
  state.days = [...state.data.history].reverse();
  slides.innerHTML = state.days.map((day) => `
    <section class="slide" data-date="${day.date}">
      <div class="metric-grid">
        ${metrics.map((metric) => metricCard(metric, day.values[metric.key], state.data.sources)).join("")}
      </div>
    </section>
  `).join("");

  const dotStart = Math.max(0, state.days.length - visibleDotCount);
  dots.innerHTML = state.days.slice(dotStart).map((day, index) => `
    <button class="dot" data-index="${dotStart + index}" aria-label="${formatDate(day.date)}"></button>
  `).join("");

  dots.querySelectorAll(".dot").forEach((dot) => {
    dot.addEventListener("click", () => goTo(Number(dot.dataset.index)));
  });

  slides.querySelectorAll(".metric-card").forEach((card) => {
    card.addEventListener("click", () => enterChart(card.dataset.metric));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        enterChart(card.dataset.metric);
      }
    });
  });

  goTo(state.days.length - 1, false);
}

function updateChrome() {
  if (state.view === "chart" && state.chartData.length) {
    dateLabel.textContent = formatFullDate(state.chartData[state.chartSelectedIndex].date);
    prevBtn.disabled = state.chartSelectedIndex <= 0;
    nextBtn.disabled = state.chartSelectedIndex >= state.chartData.length - 1;
  } else {
    const day = state.days[state.index];
    dateLabel.textContent = formatDate(day.date);
    prevBtn.disabled = state.index <= 0;
    nextBtn.disabled = state.index >= state.days.length - 1;
  }
  updatedLabel.textContent = `업데이트 ${new Date(state.data.generatedAt).toLocaleString("ko-KR")}`;
  dots.querySelectorAll(".dot").forEach((dot) => {
    dot.classList.toggle("active", Number(dot.dataset.index) === state.index);
  });
  updateInsights();
}

function goTo(index, smooth = true) {
  state.index = Math.max(0, Math.min(index, state.days.length - 1));
  const target = slides.children[state.index];
  updateChrome();
  if (state.view === "dashboard") {
    const left = target ? target.offsetLeft - slides.offsetLeft : 0;
    slides.scrollTo({ left, behavior: smooth ? "smooth" : "auto" });
  }
  refreshScoreDetail();
}

function moveDate(delta) {
  if (state.view === "chart") {
    setChartSelection(state.chartSelectedIndex + delta);
  } else {
    goTo(state.index + delta);
  }
}

async function loadData() {
  refreshBtn.disabled = true;
  updatedLabel.textContent = "자동 데이터 연결 중";
  try {
    const res = await fetch("/api/history", { cache: "no-store" });
    if (!res.ok) throw new Error("데이터를 불러오지 못했습니다");
    state.data = await res.json();
    render();
  } catch (error) {
    updatedLabel.textContent = error.message;
  } finally {
    refreshBtn.disabled = false;
  }
}

prevBtn.addEventListener("click", () => moveDate(-1));
nextBtn.addEventListener("click", () => moveDate(1));
refreshBtn.addEventListener("click", loadData);
chartClose.addEventListener("click", () => {
  if (state.view === "score") closeDetailView();
  else exitChart();
});
insightPanel.addEventListener("click", openScoreDetail);
insightPanel.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    openScoreDetail();
  }
});

slides.addEventListener("scroll", () => {
  if (!state.data || state.view === "chart") return;
  clearTimeout(slideSettleTimer);
  slideSettleTimer = setTimeout(() => {
    const positions = [...slides.children].map((child) => child.offsetLeft - slides.offsetLeft);
    const index = positions.reduce((closest, left, current) => {
      const currentDistance = Math.abs(left - slides.scrollLeft);
      const closestDistance = Math.abs(positions[closest] - slides.scrollLeft);
      return currentDistance < closestDistance ? current : closest;
    }, 0);
    if (index !== state.index && index >= 0 && index < state.days.length) {
      state.index = index;
      updateChrome();
    }
  }, 140);
});

setTimeout(() => {
  splash.classList.add("done");
  app.hidden = false;
  loadData();
}, 900);
