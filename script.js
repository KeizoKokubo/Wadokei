"use strict";

/* =========================================================================
 * 和時計シミュレーター
 * -------------------------------------------------------------------------
 * 江戸時代の不定時法（昼夜をそれぞれ6等分し、季節によって一刻の長さが
 * 伸び縮みする時刻制度）を、実際の天文計算（日の出・日の入り時刻）に基づいて
 * 再現する。文字盤は「割駒式」を模し、針は24時間で等速回転する一方、
 * 十二支・鐘の数の目盛り（駒）は季節ごとの昼夜の境目に合わせて位置を変える。
 * ========================================================================= */

(() => {

  /* ------------------------------------------------------------------- *
   * 1. 天文計算：日の出・日の入り時刻
   *    Sunrise equation (NOAA簡易式 / Wikipedia "Sunrise equation" 準拠)
   * ------------------------------------------------------------------- */

  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;
  const normDeg = (deg) => ((deg % 360) + 360) % 360;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // グレゴリオ暦 y/m/d（正午UTC相当）からユリウス日番号を求める
  function toJulianDayNumber(y, m, d) {
    const a = Math.floor((14 - m) / 12);
    const y2 = y + 4800 - a;
    const m2 = m + 12 * a - 3;
    return (
      d +
      Math.floor((153 * m2 + 2) / 5) +
      365 * y2 +
      Math.floor(y2 / 4) -
      Math.floor(y2 / 100) +
      Math.floor(y2 / 400) -
      32045
    );
  }

  // ユリウス日（小数）→ JS Date（UTC基準の絶対時刻）
  function julianToDate(jd) {
    const millis = (jd - 2440587.5) * 86400000;
    return new Date(millis);
  }

  /**
   * 指定の暦日・緯度・経度における日の出・日の入り時刻を算出する。
   * 大気差・太陽視半径を考慮した仰角 -0.833° を地平線基準として使用。
   * 均時差・太陽の視赤緯の年変化も含む実用的な精度（誤差 概ね±1分程度）。
   *
   * @param {number} y 西暦年
   * @param {number} m 月(1-12)
   * @param {number} d 日
   * @param {number} lat 緯度（北緯 正）
   * @param {number} lonDeg 経度（東経 正）
   * @returns {{sunrise: Date, sunset: Date, transit: Date} | {polar: 'day'|'night'}}
   */
  function computeSunTimes(y, m, d, lat, lonDeg) {
    const JD = toJulianDayNumber(y, m, d);
    const lw = -lonDeg; // 式は西経を正とする慣習のため符号反転
    const n = Math.round(JD - 2451545.0009 - lw / 360);
    const Jstar = 2451545.0009 + lw / 360 + n;

    const M_deg = normDeg(357.5291 + 0.98560028 * (Jstar - 2451545));
    const M = toRad(M_deg);
    const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
    const lambda_deg = normDeg(M_deg + 102.9372 + C + 180);
    const lambda = toRad(lambda_deg);

    const Jtransit = Jstar + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * lambda);
    const delta = Math.asin(Math.sin(lambda) * Math.sin(toRad(23.4397)));
    const phi = toRad(lat);

    const cosOmega0 =
      (Math.sin(toRad(-0.833)) - Math.sin(phi) * Math.sin(delta)) /
      (Math.cos(phi) * Math.cos(delta));

    if (cosOmega0 > 1) return { polar: "night" }; // 極夜
    if (cosOmega0 < -1) return { polar: "day" }; // 白夜

    const omega0_deg = toDeg(Math.acos(clamp(cosOmega0, -1, 1)));
    const Jrise = Jtransit - omega0_deg / 360;
    const Jset = Jtransit + omega0_deg / 360;

    return {
      sunrise: julianToDate(Jrise),
      sunset: julianToDate(Jset),
      transit: julianToDate(Jtransit),
    };
  }

  /* ------------------------------------------------------------------- *
   * 2. 不定時法：刻・十二支・鐘の数への変換
   * ------------------------------------------------------------------- */

  // 昼の6区分（明六つ→暮六つ手前まで）と夜の6区分（暮六つ→明六つ手前まで）
  const DAY_KOKU = [
    { eto: "卯", etoReading: "う", bell: "六つ", bellNum: 6, kind: "明六つ", major: false },
    { eto: "辰", etoReading: "たつ", bell: "五つ", bellNum: 5, kind: null, major: false },
    { eto: "巳", etoReading: "み", bell: "四つ", bellNum: 4, kind: null, major: false },
    { eto: "午", etoReading: "うま", bell: "九つ", bellNum: 9, kind: "正午", major: true },
    { eto: "未", etoReading: "ひつじ", bell: "八つ", bellNum: 8, kind: null, major: false },
    { eto: "申", etoReading: "さる", bell: "七つ", bellNum: 7, kind: null, major: false },
  ];

  // 一刻（一時）を4等分する古い呼び方。「丑三つ時（うしみつどき）」のように
  // 十二支＋この名称＋「時」で呼んだ（例：「草木も眠る丑三つ時」＝丑の刻の3/4付近）。
  const QUARTER_NAMES = ["一つ", "二つ", "三つ", "四つ"];

  const NIGHT_KOKU = [
    { eto: "酉", etoReading: "とり", bell: "六つ", bellNum: 6, kind: "暮六つ", major: false },
    { eto: "戌", etoReading: "いぬ", bell: "五つ", bellNum: 5, kind: null, major: false },
    { eto: "亥", etoReading: "い", bell: "四つ", bellNum: 4, kind: null, major: false },
    { eto: "子", etoReading: "ね", bell: "九つ", bellNum: 9, kind: "正子", major: true },
    { eto: "丑", etoReading: "うし", bell: "八つ", bellNum: 8, kind: null, major: false },
    { eto: "寅", etoReading: "とら", bell: "七つ", bellNum: 7, kind: null, major: false },
  ];

  /**
   * localYMDに対する太陽時刻（前日・当日・翌日）から、12個の刻の境界時刻の
   * 一覧（十二支・鐘の数ラベル付き）と、指定した瞬間 instant がどの刻に
   * 属するかを求める。
   */
  function buildWadokeiCycle(sunYesterday, sunToday, sunTomorrow, instant) {
    // 「アンカー」となる基準日を決める：instant が本日の日の出以降なら本日、
    // まだ日の出前（＝前夜の続き）なら前日を基準に12境界を組み立てる。
    let anchorSunrise, anchorSunset, followingSunrise;
    if (instant >= sunToday.sunrise) {
      anchorSunrise = sunToday.sunrise;
      anchorSunset = sunToday.sunset;
      followingSunrise = sunTomorrow.sunrise;
    } else {
      anchorSunrise = sunYesterday.sunrise;
      anchorSunset = sunYesterday.sunset;
      followingSunrise = sunToday.sunrise;
    }

    const dayKokuMs = (anchorSunset - anchorSunrise) / 6;
    const nightKokuMs = (followingSunrise - anchorSunset) / 6;

    const boundaries = [];
    for (let i = 0; i < 6; i++) {
      boundaries.push({
        time: new Date(anchorSunrise.getTime() + dayKokuMs * i),
        ...DAY_KOKU[i],
        periodMs: dayKokuMs,
      });
    }
    for (let i = 0; i < 6; i++) {
      boundaries.push({
        time: new Date(anchorSunset.getTime() + nightKokuMs * i),
        ...NIGHT_KOKU[i],
        periodMs: nightKokuMs,
      });
    }

    // instant が属する区間を特定
    let currentIndex = boundaries.length - 1;
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i].time;
      const end = i + 1 < boundaries.length ? boundaries[i + 1].time : followingSunrise;
      if (instant >= start && instant < end) {
        currentIndex = i;
        break;
      }
    }
    const current = boundaries[currentIndex];
    const currentEnd =
      currentIndex + 1 < boundaries.length ? boundaries[currentIndex + 1].time : followingSunrise;
    const progress = clamp((instant - current.time) / (currentEnd - current.time), 0, 1);

    // 一刻（一時）をさらに4等分した「一つ時・二つ時・三つ時・四つ時」
    // （例：「丑三つ時」）。一刻の長さそのものが季節で伸び縮みするため、
    // 四半分もそれに合わせて実時間換算での長さが変わる。
    const quarterIndex = clamp(Math.floor(progress * 4), 0, 3);
    const quarterName = QUARTER_NAMES[quarterIndex];

    return {
      boundaries,
      followingSunrise,
      current,
      currentIndex,
      currentEnd,
      progress,
      quarterIndex,
      quarterName,
      dayKokuMs,
      nightKokuMs,
      anchorSunrise,
      anchorSunset,
    };
  }

  /* ------------------------------------------------------------------- *
   * 3. 時刻・タイムゾーンのユーティリティ
   * ------------------------------------------------------------------- */

  // 指定タイムゾーンでの instant の年月日（ローカル暦日）を取得
  function getLocalYMD(instant, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
    return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
  }

  // 指定タイムゾーンでの instant の「時刻（0-24の小数）」を取得
  function getLocalHourFloat(instant, timeZone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
    return Number(parts.hour) + Number(parts.minute) / 60 + Number(parts.second) / 3600;
  }

  function shiftYMD(ymd, deltaDays) {
    // Y/M/D のみを UTC 正午起点で加減算する（時刻情報を持たない暦日演算）
    const base = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12);
    const shifted = new Date(base + deltaDays * 86400000);
    return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
  }

  function fmtTime(date, timeZone) {
    return date.toLocaleTimeString("ja-JP", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  function fmtDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `約${h}時間${m}分`;
    return `約${m}分`;
  }

  /* ------------------------------------------------------------------- *
   * 4. アプリケーション状態
   * ------------------------------------------------------------------- */

  const EDO = { lat: 35.6895, lon: 139.6917, timeZone: "Asia/Tokyo", label: "江戸（東京）" };

  const state = {
    location: { ...EDO },
    locationMode: "edo", // 'edo' | 'here'
    dateOffsetDays: 0, // スライダーによる「今日」からの日数オフセット
    fastForward: null, // 早送り再生中の状態（null なら通常のリアルタイム表示）
  };

  const todayYMD = (() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  })();

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }
  const daysInYear = isLeapYear(todayYMD.y) ? 366 : 365;

  function simulatedYMD() {
    return shiftYMD(todayYMD, state.dateOffsetDays);
  }

  /* ------------------------------------------------------------------- *
   * 5. SVG 文字盤の描画
   * ------------------------------------------------------------------- */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const svg = document.getElementById("clockFace");
  const CX = 200, CY = 200;
  const R_OUTER = 178, R_KOMA_OUT = 178, R_KOMA_IN = 148;
  const R_LABEL = 130, R_SUBLABEL = 100, R_ARC = 178, R_HAND = 118, R_HAND_MINOR = 78;

  function angleForHour(hourFloat) {
    // 12時（正午）を真上(0deg)、時計回りを正の角度とする
    return ((hourFloat - 12) / 24) * 360;
  }

  function polarToXY(r, angleDeg) {
    const rad = toRad(angleDeg);
    return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
  }

  function arcPath(rInner, rOuter, angleStart, angleEnd) {
    // angleStart→angleEnd（時計回り、常に0-360の範囲に正規化して短経路優先ではなく実角度差を使用）
    let a0 = angleStart, a1 = angleEnd;
    if (a1 < a0) a1 += 360;
    const large = a1 - a0 > 180 ? 1 : 0;
    const p0 = polarToXY(rOuter, a0);
    const p1 = polarToXY(rOuter, a1);
    const p2 = polarToXY(rInner, a1);
    const p3 = polarToXY(rInner, a0);
    return [
      `M ${p0.x} ${p0.y}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p1.x} ${p1.y}`,
      `L ${p2.x} ${p2.y}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p3.x} ${p3.y}`,
      "Z",
    ].join(" ");
  }

  function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function renderClockFace(cycle, nowHourAngle, timeZone) {
    svg.innerHTML = "";

    // 外周の輪（土台となる文字盤の地色。先に描いておき、昼夜の帯を上から重ねる）
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_OUTER, class: "face-ring" }));

    // 昼夜の帯（明六つ〜暮六つが昼、残りが夜）― 文字盤の地の上に重ねて色分けする
    const dayStartAngle = angleForHour(getLocalHourFloat(cycle.anchorSunrise, timeZone));
    const dayEndAngle = angleForHour(getLocalHourFloat(cycle.anchorSunset, timeZone));
    // 全周(0〜360度)は始点と終点が一致し弧として描画できないため、円要素で夜を塗ってから昼を重ねる
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_ARC, class: "night-arc" }));
    svg.appendChild(
      el("path", { d: arcPath(0, R_ARC, dayStartAngle, dayEndAngle), class: "day-arc" })
    );
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_OUTER, class: "face-ring-edge" }));

    // 12の駒（十二支・鐘の数の目盛り）― 昼（明六つ〜暮六つ）と夜（暮六つ〜明六つ）で色分け
    cycle.boundaries.forEach((b, i) => {
      const isDay = i < 6;
      const dayNightClass = b.major ? "" : isDay ? " is-day" : " is-night";
      const hourFloat = getLocalHourFloat(b.time, timeZone);
      const angle = angleForHour(hourFloat);
      const pOut = polarToXY(R_KOMA_OUT, angle);
      const pIn = polarToXY(R_KOMA_IN, angle);
      svg.appendChild(
        el("line", {
          x1: pIn.x, y1: pIn.y, x2: pOut.x, y2: pOut.y,
          class: `koma-line${b.major ? " is-major" : ""}${dayNightClass}`,
        })
      );
      const pLabel = polarToXY(R_LABEL, angle);
      const label = el("text", {
        x: pLabel.x, y: pLabel.y,
        class: `koma-label${b.major ? " is-major" : ""}${dayNightClass}`,
      });
      label.textContent = b.eto;
      svg.appendChild(label);

      // 明六つ・暮六つ（日の出・日の入り）は名称そのものを表示して境目を明示する
      const isRiseOrSet = b.kind === "明六つ" || b.kind === "暮六つ";
      const pSub = polarToXY(R_SUBLABEL, angle);
      const sub = el("text", {
        x: pSub.x, y: pSub.y,
        class: `koma-sublabel${dayNightClass}${isRiseOrSet ? " is-boundary" : ""}`,
      });
      sub.textContent = isRiseOrSet ? b.kind : b.bell;
      svg.appendChild(sub);

      // 日の出・日の入りの位置に小さな目印（昼=暖色の丸、夜=藍色の丸）を添える
      if (isRiseOrSet) {
        const pMark = polarToXY(R_KOMA_OUT + 10, angle);
        svg.appendChild(
          el("circle", {
            cx: pMark.x, cy: pMark.y, r: 4,
            class: `rise-set-mark ${b.kind === "明六つ" ? "sun" : "moon"}`,
          })
        );
      }
    });

    // 「一つ時・二つ時・三つ時・四つ時」―― 各刻を実際に4等分した細目盛り。
    // 一刻の長さ自体が季節・昼夜で伸び縮みするため、その内部の等分点も
    // 固定角度ではなく、各刻の実時間を4分割して個別に角度を求める。
    cycle.boundaries.forEach((b, i) => {
      const isDay = i < 6;
      const endTime = i + 1 < cycle.boundaries.length ? cycle.boundaries[i + 1].time : cycle.followingSunrise;
      const spanMs = endTime - b.time;
      for (let q = 1; q <= 3; q++) {
        const t = new Date(b.time.getTime() + spanMs * (q / 4));
        const angle = angleForHour(getLocalHourFloat(t, timeZone));
        const pOut = polarToXY(R_KOMA_OUT, angle);
        const pIn = polarToXY(R_KOMA_OUT - 9, angle);
        svg.appendChild(
          el("line", {
            x1: pIn.x, y1: pIn.y, x2: pOut.x, y2: pOut.y,
            class: `quarter-tick${isDay ? " is-day" : " is-night"}`,
          })
        );
      }
    });

    // 針（現在時刻を指す。二重描画で影をつける）
    const handEnd = polarToXY(R_HAND, nowHourAngle);
    const handBack = polarToXY(R_HAND_MINOR * 0.35, nowHourAngle + 180);
    svg.appendChild(
      el("line", { x1: handBack.x, y1: handBack.y, x2: handEnd.x, y2: handEnd.y, class: "hand-shadow" })
    );
    svg.appendChild(
      el("line", { x1: handBack.x, y1: handBack.y, x2: handEnd.x, y2: handEnd.y, class: "hand" })
    );
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: 6, class: "face-center-dot" }));
  }

  /* ------------------------------------------------------------------- *
   * 6. 情報パネルの更新
   * ------------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  function updateInfoPanel(cycle, sunToday, sunTomorrow, timeZone) {
    $("kokuBell").textContent = cycle.current.bell;
    $("kokuEto").textContent = `（${cycle.current.eto}の刻）`;
    const kindText = cycle.current.kind ? `${cycle.current.kind}／` : "";
    $("kokuReading").textContent = `${kindText}${cycle.current.eto}（${cycle.current.etoReading}）の刻`;
    $("kokuQuarterLabel").textContent = `${cycle.current.eto}${cycle.quarterName}時`;
    $("kokuProgressText").textContent = `この刻の ${Math.round(cycle.progress * 100)}% が経過`;

    $("sunriseTime").textContent = fmtTime(sunToday.sunrise, timeZone);
    $("sunsetTime").textContent = fmtTime(sunToday.sunset, timeZone);

    const dayLenMs = sunToday.sunset - sunToday.sunrise;
    const nightLenMs = sunTomorrow.sunrise - sunToday.sunset;
    $("dayKokuLen").textContent = fmtDuration(dayLenMs / 6);
    $("nightKokuLen").textContent = fmtDuration(nightLenMs / 6);
  }

  /* ------------------------------------------------------------------- *
   * 7. メインループ
   * ------------------------------------------------------------------- */

  function render(instant) {
    const loc = state.location;
    const ymd = getLocalYMD(instant, loc.timeZone);
    const yesterdayYMD = shiftYMD(ymd, -1);
    const tomorrowYMD = shiftYMD(ymd, 1);

    const sunYesterday = computeSunTimes(yesterdayYMD.y, yesterdayYMD.m, yesterdayYMD.d, loc.lat, loc.lon);
    const sunToday = computeSunTimes(ymd.y, ymd.m, ymd.d, loc.lat, loc.lon);
    const sunTomorrow = computeSunTimes(tomorrowYMD.y, tomorrowYMD.m, tomorrowYMD.d, loc.lat, loc.lon);

    if (sunToday.polar || sunYesterday.polar || sunTomorrow.polar) {
      // 極域（白夜・極夜）で日の出入りが定義できない場合のフォールバック表示
      $("kokuBell").textContent = "―";
      $("kokuEto").textContent = "";
      $("kokuReading").textContent = "この地・この日は白夜／極夜のため、不定時法が定義できません。";
      $("kokuQuarterLabel").textContent = "―";
      $("kokuProgressText").textContent = "";
      return;
    }

    const cycle = buildWadokeiCycle(sunYesterday, sunToday, sunTomorrow, instant);
    const nowHourAngle = angleForHour(getLocalHourFloat(instant, loc.timeZone));

    renderClockFace(cycle, nowHourAngle, loc.timeZone);
    updateInfoPanel(cycle, sunToday, sunTomorrow, loc.timeZone);
  }

  function currentInstant() {
    if (state.fastForward) {
      const elapsedReal = performance.now() - state.fastForward.startPerf;
      const simMs =
        state.fastForward.dayStart.getTime() + elapsedReal * state.fastForward.speed;
      return new Date(simMs);
    }
    return new Date(Date.now() + state.dateOffsetDays * 86400000);
  }

  function tick() {
    const instant = currentInstant();

    if (state.fastForward) {
      const elapsedMs = instant - state.fastForward.dayStart;
      if (elapsedMs >= 24 * 3600 * 1000) {
        stopFastForward();
        return; // stopFastForward が再描画も行う
      }
    }

    render(instant);
  }

  let tickHandle = null;
  function startTicking() {
    if (tickHandle) return;
    tick();
    tickHandle = setInterval(tick, state.fastForward ? 60 : 1000);
  }
  function restartTicking() {
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    startTicking();
  }

  /* ------------------------------------------------------------------- *
   * 8. 早送り再生
   * ------------------------------------------------------------------- */

  const playBtn = $("playBtn");

  function startFastForward() {
    const ymd = simulatedYMD();
    // その日のローカル正午UTC相当を起点に、日付境界をまたがない範囲で1日分を早送り
    const dayStart = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0));
    const speed = (24 * 3600 * 1000) / 18000; // 24時間を実時間18秒で一周
    state.fastForward = { startPerf: performance.now(), dayStart, speed };
    playBtn.textContent = "早送り再生を停止 ■";
    playBtn.classList.add("is-playing");
    restartTicking();
  }

  function stopFastForward() {
    state.fastForward = null;
    playBtn.textContent = "一日を早送り再生 ▶";
    playBtn.classList.remove("is-playing");
    restartTicking();
  }

  playBtn.addEventListener("click", () => {
    if (state.fastForward) stopFastForward();
    else startFastForward();
  });

  /* ------------------------------------------------------------------- *
   * 9. 日付スライダー・場所切替UI
   * ------------------------------------------------------------------- */

  const dateSlider = $("dateSlider");
  const dateLabel = $("dateLabel");
  const todayBtn = $("todayBtn");
  const locEdoBtn = $("locEdoBtn");
  const locHereBtn = $("locHereBtn");
  const locStatus = $("locStatus");

  dateSlider.min = 0;
  dateSlider.max = daysInYear - 1;

  const todayDayOfYear = (() => {
    const start = Date.UTC(todayYMD.y, 0, 1);
    const cur = Date.UTC(todayYMD.y, todayYMD.m - 1, todayYMD.d);
    return Math.round((cur - start) / 86400000);
  })();
  dateSlider.value = todayDayOfYear;

  function formatSimulatedDateLabel() {
    const ymd = simulatedYMD();
    const isToday = state.dateOffsetDays === 0;
    return `${ymd.m}月${ymd.d}日${isToday ? "（今日）" : ""}`;
  }

  function onDateSliderChange() {
    const dayOfYear = Number(dateSlider.value);
    state.dateOffsetDays = dayOfYear - todayDayOfYear;
    dateLabel.textContent = formatSimulatedDateLabel();
    if (state.fastForward) stopFastForward();
    else restartTicking();
  }

  dateSlider.addEventListener("input", onDateSliderChange);

  todayBtn.addEventListener("click", () => {
    dateSlider.value = todayDayOfYear;
    onDateSliderChange();
  });

  function setLocation(mode) {
    state.locationMode = mode;
    locEdoBtn.classList.toggle("active", mode === "edo");
    locHereBtn.classList.toggle("active", mode === "here");

    if (mode === "edo") {
      state.location = { ...EDO };
      locStatus.textContent = "北緯35.69°　東経139.69°（東京・旧江戸）";
      restartTicking();
      return;
    }

    locStatus.textContent = "現在地を取得中…";
    if (!navigator.geolocation) {
      locStatus.textContent = "この環境では位置情報を取得できません。江戸の座標を使用します。";
      state.location = { ...EDO };
      restartTicking();
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Tokyo";
        state.location = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          timeZone: tz,
          label: "現在地",
        };
        locStatus.textContent = `北緯${pos.coords.latitude.toFixed(2)}°　東経${pos.coords.longitude.toFixed(2)}°`;
        restartTicking();
      },
      () => {
        locStatus.textContent = "位置情報の取得が許可されませんでした。江戸の座標を使用します。";
        locEdoBtn.classList.add("active");
        locHereBtn.classList.remove("active");
        state.locationMode = "edo";
        state.location = { ...EDO };
        restartTicking();
      },
      { timeout: 8000 }
    );
  }

  locEdoBtn.addEventListener("click", () => setLocation("edo"));
  locHereBtn.addEventListener("click", () => setLocation("here"));

  /* ------------------------------------------------------------------- *
   * 10. 初期化
   * ------------------------------------------------------------------- */

  dateLabel.textContent = formatSimulatedDateLabel();
  startTicking();
})();
