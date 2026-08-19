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
  const ONE_DAY_MS = 24 * 3600 * 1000;
  const FAST_FORWARD_REAL_DURATION_MS = 36000;

  const state = {
    location: { ...EDO },
    locationMode: "edo", // 'edo' | 'here'
    dateOffsetDays: 0, // スライダーによる「今日」からの日数オフセット
    fastForward: null, // 早送り再生中の状態（null なら通常のリアルタイム表示）
    showModernClock: false, // 文字盤クリックで、現代の24時間定時法時計を重ねて表示
    animationsEnabled: true, // 刻・半時に連動する季節演出（初期値ON）
    bellsEnabled: false, // 江戸の時の鐘（音声操作が必要なため初期値OFF）
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
  const R_LABEL = 130, R_SUBLABEL = 100, R_SUBLABEL_BOUNDARY = 160, R_ARC = 178, R_HAND = 118, R_HAND_MINOR = 78;
  // 現代の24時間時計オーバーレイ（不定時法の文字盤と同じ中心・同じ角度基準を共有する）
  const R_MODERN = 85, R_MODERN_TICK_MAJOR_IN = 70, R_MODERN_TICK_MINOR_IN = 77, R_MODERN_LABEL = 60;

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

  // 現代（定時法）の24時間時計を、不定時法の文字盤と同じ中心・同じ角度基準
  // （正午=真上、時計回り）で描く。角度基準を共有しているため、針は
  // 描き直す必要がなく、外側の和時計と全く同じ向きを指したまま重なる。
  function renderModernClock() {
    svg.appendChild(el("circle", { cx: CX, cy: CY, r: R_MODERN, class: "modern-clock-face" }));
    for (let h = 0; h < 24; h++) {
      const isMajor = h % 3 === 0;
      const angle = angleForHour(h);
      const rIn = isMajor ? R_MODERN_TICK_MAJOR_IN : R_MODERN_TICK_MINOR_IN;
      const pOut = polarToXY(R_MODERN, angle);
      const pIn = polarToXY(rIn, angle);
      svg.appendChild(
        el("line", {
          x1: pIn.x, y1: pIn.y, x2: pOut.x, y2: pOut.y,
          class: `modern-tick${isMajor ? " is-major" : ""}`,
        })
      );
      if (isMajor) {
        const pLabel = polarToXY(R_MODERN_LABEL, angle);
        const label = el("text", {
          x: pLabel.x, y: pLabel.y,
          class: `modern-label${h === 12 ? " is-noon" : ""}`,
        });
        label.textContent = String(h);
        svg.appendChild(label);
      }
    }
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

      // 明六つ・暮六つ（日の出・日の入り）は名称そのものを表示して境目を明示する。
      // この2つは卯・酉に近い、ほぼ水平な角度になりやすく、通常の位置（R_SUBLABEL）
      // だと横書きの文字幅が中心方向へはみ出し、中央の現代時計オーバーレイや
      // 卯・酉の文字と重なってしまう。十二支の文字（R_LABEL）より外側、
      // 主目盛りの輪の内側という隙間（R_SUBLABEL_BOUNDARY）に配置して両方を避ける。
      const isRiseOrSet = b.kind === "明六つ" || b.kind === "暮六つ";
      const pSub = polarToXY(isRiseOrSet ? R_SUBLABEL_BOUNDARY : R_SUBLABEL, angle);
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

    // 現代の24時間時計オーバーレイ（クリックでトグル）。針より先に描き、
    // 針が両方の文字盤の上に重なって見えるようにする
    if (state.showModernClock) {
      renderModernClock();
    }

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

  /* ------------------------------------------------------------------- *
   * 6. 時刻連動アニメーション
   * ------------------------------------------------------------------- */

  const animationLayer = $("animationLayer");
  const animationToggle = $("animationToggle");
  const animationToggleLabel = $("animationToggleLabel");
  const bellToggle = $("bellToggle");
  const bellToggleLabel = $("bellToggleLabel");
  const eventPanels = [...document.querySelectorAll("[data-event-panel]")];
  let nextEventPanel = 0;
  let audioContext = null;
  const activeBellOscillators = new Set();

  // 生成した4列×3行の透過スプライト。十二支の標準順で格納している。
  const ZODIAC_SPRITES = {
    子: { name: "鼠", x: "0%", y: "0%" },
    丑: { name: "牛", x: "33.333%", y: "0%" },
    寅: { name: "虎", x: "66.667%", y: "0%" },
    卯: { name: "兎", x: "100%", y: "0%" },
    辰: { name: "龍", x: "0%", y: "50%" },
    巳: { name: "蛇", x: "33.333%", y: "50%" },
    午: { name: "馬", x: "66.667%", y: "50%" },
    未: { name: "羊", x: "100%", y: "50%" },
    申: { name: "猿", x: "0%", y: "100%" },
    酉: { name: "鶏", x: "33.333%", y: "100%" },
    戌: { name: "犬", x: "66.667%", y: "100%" },
    亥: { name: "猪", x: "100%", y: "100%" },
  };

  const SEASONAL_MOTIFS = [
    { id: "butterfly", label: "蝶", glyph: "🦋", pattern: "swarm", color: "#9b4d36", seasons: [3.2, 1.3, 0.35, 0.05], day: 1.8, night: 0.18 },
    { id: "frog", label: "蛙", glyph: "🐸", pattern: "bloom", color: "#49633c", seasons: [1.0, 2.8, 0.45, 0.05], day: 0.7, night: 1.35 },
    { id: "ant", label: "蟻の行列", glyph: "🐜", pattern: "swarm", color: "#2b2622", seasons: [1.0, 2.1, 0.7, 0.05], day: 1.6, night: 0.2 },
    { id: "dragonfly", label: "蜻蛉", glyph: "蜻蛉", pattern: "swarm", color: "#8e3620", seasons: [0.25, 1.0, 3.2, 0.05], day: 1.45, night: 0.25 },
    { id: "sakura", label: "桜の花びら", glyph: "🌸", pattern: "particle", color: "#c77c83", seasons: [4.2, 0.08, 0.02, 0.02], day: 1.1, night: 0.65 },
    { id: "snow", label: "雪", glyph: "❄", pattern: "particle", color: "#7180a2", seasons: [0.08, 0.01, 0.08, 4.4], day: 1.0, night: 1.2 },
    { id: "rain", label: "時雨", glyph: "│", pattern: "particle", color: "#526487", seasons: [1.4, 2.4, 1.3, 0.65], day: 1.0, night: 0.9 },
    { id: "thunder", label: "遠雷", glyph: "⚡", pattern: "flash", color: "#b8934a", seasons: [0.2, 3.5, 0.75, 0.04], day: 0.75, night: 1.65 },
    { id: "bee", label: "蜂", glyph: "🐝", pattern: "swarm", color: "#a16a19", seasons: [2.3, 1.7, 0.3, 0.02], day: 2.0, night: 0.04 },
    { id: "beetle", label: "カブトムシ", glyph: "🪲", pattern: "traveler", color: "#30271e", seasons: [0.08, 3.1, 0.45, 0.01], day: 0.5, night: 1.55 },
    { id: "sprout", label: "芽吹き", glyph: "🌱", pattern: "bloom", color: "#577044", seasons: [3.4, 0.5, 0.05, 0.12], day: 1.25, night: 0.45 },
    { id: "morning-glory", label: "朝顔", glyph: "🌺", pattern: "bloom", color: "#394b82", seasons: [0.1, 3.0, 0.45, 0.01], day: 1.45, night: 0.3 },
    { id: "chrysanthemum", label: "菊", glyph: "🏵️", pattern: "bloom", color: "#a17b22", seasons: [0.05, 0.25, 3.5, 0.25], day: 1.2, night: 0.55 },
    { id: "leaves", label: "落ち葉", glyph: "🍂", pattern: "particle", color: "#9b5a32", seasons: [0.05, 0.15, 4.0, 0.55], day: 1.1, night: 0.75 },
  ];

  const EVERYDAY_MOTIFS = [
    { id: "courier", label: "飛脚", glyph: "飛脚", pattern: "traveler", color: "#6b3f2a", weight: 1.1, day: 1.65, night: 0.35 },
    { id: "kago", label: "駕籠かき", glyph: "人━駕籠━人", pattern: "traveler", color: "#4a2a1a", weight: 0.9, day: 1.45, night: 0.45 },
    { id: "townsman", label: "町人", glyph: "町人", pattern: "traveler", color: "#4a423a", weight: 1.0, day: 1.4, night: 0.65 },
    { id: "town-girl", label: "町娘", glyph: "町娘", pattern: "traveler", color: "#9b4d50", weight: 0.85, day: 1.35, night: 0.65 },
    { id: "samurai", label: "侍", glyph: "侍", pattern: "traveler", color: "#27345f", weight: 0.9, day: 1.2, night: 0.8 },
    { id: "soba", label: "蕎麦の屋台", glyph: "蕎麦の屋台", pattern: "traveler", color: "#8e5b24", weight: 0.8, day: 0.35, night: 1.9 },
    { id: "meakashi", label: "目明し", glyph: "目明し", pattern: "traveler", color: "#34343a", weight: 0.75, day: 0.55, night: 1.55 },
    { id: "barrel", label: "風に転がる桶", glyph: "風→→桶", pattern: "rolling", color: "#7b4c2f", weight: 0.85, day: 1.0, night: 0.8 },
    { id: "cat", label: "猫", glyph: "🐈", pattern: "bloom", color: "#59453a", weight: 1.15, day: 0.8, night: 1.35 },
  ];

  const animationClock = { lastInstantMs: null };

  function getSeasonIndex(month) {
    if (month >= 3 && month <= 5) return 0; // 春
    if (month >= 6 && month <= 8) return 1; // 夏
    if (month >= 9 && month <= 11) return 2; // 秋
    return 3; // 冬
  }

  function weightedRandom(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let cursor = Math.random() * total;
    for (const item of items) {
      cursor -= item.weight;
      if (cursor <= 0) return item.value;
    }
    return items[items.length - 1].value;
  }

  function chooseAmbientMotif(instant, isDay, timeZone) {
    const seasonIndex = getSeasonIndex(getLocalYMD(instant, timeZone).m);
    const periodKey = isDay ? "day" : "night";
    const seasonal = SEASONAL_MOTIFS.map((motif) => ({
      value: motif,
      weight: motif.seasons[seasonIndex] * motif[periodKey],
    }));
    const everyday = EVERYDAY_MOTIFS.map((motif) => ({
      value: motif,
      weight: motif.weight * motif[periodKey],
    }));
    // 季節物を約65%、江戸の日常物を約35%の基礎比率で混ぜ、個別重みを掛ける。
    return weightedRandom([
      ...seasonal.map((entry) => ({ ...entry, weight: entry.weight * 1.55 })),
      ...everyday.map((entry) => ({ ...entry, weight: entry.weight * 0.85 })),
    ].filter((entry) => entry.weight > 0));
  }

  function removeAfterAnimation(node, delayMs) {
    const cleanup = () => node.remove();
    node.addEventListener("animationend", (event) => {
      if (event.target === node) cleanup();
    });
    setTimeout(cleanup, delayMs);
  }

  function showEventPanel(kicker, label, instant, timeZone, color) {
    const panel = eventPanels[nextEventPanel];
    if (!panel) return;
    nextEventPanel = (nextEventPanel + 1) % eventPanels.length;
    const token = String(Date.now() + Math.random());
    panel.dataset.token = token;
    panel.style.setProperty("--event-color", color || "#9b3d2c");
    panel.innerHTML = `<span class="event-panel-kicker">${kicker}</span><strong>${label}</strong><time>${fmtTime(instant, timeZone)}</time>`;
    panel.classList.add("is-visible");
    setTimeout(() => {
      if (panel.dataset.token === token) panel.classList.remove("is-visible");
    }, state.fastForward ? 6200 : 16000);
  }

  function capConcurrent(selector, maxCount) {
    const nodes = animationLayer.querySelectorAll(selector);
    for (let i = 0; i < nodes.length - maxCount; i++) nodes[i].remove();
  }

  function ensureAudioContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioContext = new AudioContextClass();
    }
    if (audioContext?.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function strikeBell(atTime, strength = 1) {
    const context = ensureAudioContext();
    if (!context) return;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, atTime);
    master.gain.exponentialRampToValueAtTime(0.19 * strength, atTime + 0.018);
    master.gain.exponentialRampToValueAtTime(0.0001, atTime + 2.8);
    master.connect(context.destination);
    [196, 294, 392, 510].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const partial = context.createGain();
      oscillator.type = index === 0 ? "sine" : "triangle";
      oscillator.frequency.setValueAtTime(frequency * (1 + index * 0.006), atTime);
      partial.gain.value = [0.75, 0.3, 0.15, 0.08][index];
      oscillator.connect(partial).connect(master);
      activeBellOscillators.add(oscillator);
      oscillator.addEventListener("ended", () => activeBellOscillators.delete(oscillator), { once: true });
      oscillator.start(atTime);
      oscillator.stop(atTime + 3);
    });
  }

  function ringTimeBell(count) {
    if (!state.bellsEnabled) return;
    const context = ensureAudioContext();
    if (!context) return;
    const interval = state.fastForward ? 0.18 : 0.72;
    for (let i = 0; i < count; i++) {
      strikeBell(context.currentTime + i * interval, i === 0 ? 1 : 0.82);
    }
  }

  function stopTimeBells() {
    activeBellOscillators.forEach((oscillator) => {
      try { oscillator.stop(); } catch (_) { /* すでに停止済みなら何もしない */ }
    });
    activeBellOscillators.clear();
  }

  function showZodiacAnimation(boundary, instant, timeZone) {
    const sprite = ZODIAC_SPRITES[boundary.eto];
    if (!sprite || !state.animationsEnabled) return;
    // 早送り中も複数の刻の干支が重ならないよう、画面上は常に1匹だけにする。
    animationLayer.querySelectorAll(".zodiac-crossing").forEach((node) => node.remove());

    const actor = document.createElement("div");
    actor.className = `zodiac-crossing${state.fastForward ? " is-fast" : ""}`;
    actor.style.setProperty("--travel-y", `${24 + Math.random() * 34}vh`);

    const image = document.createElement("span");
    image.className = "zodiac-sprite";
    image.style.setProperty("--sprite-x", sprite.x);
    image.style.setProperty("--sprite-y", sprite.y);
    actor.appendChild(image);
    animationLayer.appendChild(actor);
    showEventPanel("刻の始まり", `${boundary.eto}の刻・${sprite.name}`, instant, timeZone, "#9b3d2c");
    removeAfterAnimation(actor, state.fastForward ? 6200 : 16000);
  }

  function addParticles(event, motif) {
    const isSwarm = motif.pattern === "swarm";
    event.classList.toggle("is-swarm", isSwarm);
    const baseCount = isSwarm ? 7 : motif.id === "rain" ? 34 : motif.id === "snow" ? 20 : 16;
    const count = baseCount * 3;
    for (let i = 0; i < count; i++) {
      const particle = document.createElement("span");
      particle.className = "ambient-particle";
      particle.textContent = motif.glyph;
      particle.style.setProperty("--particle-color", motif.color);
      particle.style.setProperty("--x", `${Math.random() * 96}vw`);
      particle.style.setProperty("--y", `${18 + Math.random() * 58}vh`);
      particle.style.setProperty("--delay", `${Math.random() * 3}s`);
      particle.style.setProperty("--duration", `${7.2 + Math.random() * 5.6}s`);
      particle.style.setProperty("--fast-delay", `${Math.random() * 1.25}s`);
      particle.style.setProperty("--fast-duration", `${2.1 + Math.random() * 1.8}s`);
      particle.style.setProperty("--drift", `${-12 + Math.random() * 28}vw`);
      particle.style.setProperty("--rotation", `${240 + Math.random() * 620}deg`);
      particle.style.setProperty("--size", `${0.72 + Math.random() * 1.15}rem`);
      particle.style.setProperty("--swarm-mid-x", `${28 + Math.random() * 20}vw`);
      particle.style.setProperty("--swarm-rise", `${-10 + Math.random() * 17}vh`);
      particle.style.setProperty("--swarm-late-y", `${-7 + Math.random() * 15}vh`);
      particle.style.setProperty("--swarm-end-y", `${-8 + Math.random() * 17}vh`);
      event.appendChild(particle);
    }
  }

  function showAmbientAnimation(motif, instant, timeZone) {
    if (!motif || !state.animationsEnabled) return;
    capConcurrent(".ambient-event", 2);
    const event = document.createElement("div");
    event.className = `ambient-event${state.fastForward ? " is-fast" : ""}`;

    if (motif.pattern === "particle" || motif.pattern === "swarm") {
      addParticles(event, motif);
    } else if (motif.pattern === "flash") {
      event.classList.add("ambient-lightning");
      event.style.setProperty("--bolt-x", `${24 + Math.random() * 52}vw`);
      event.style.setProperty("--flash-delay-a", `${Math.random() * 0.65}s`);
      event.style.setProperty("--flash-delay-b", `${0.3 + Math.random() * 0.9}s`);
      for (let i = 0; i < 3; i++) {
        const bolt = document.createElement("span");
        bolt.className = "ambient-bolt";
        bolt.style.setProperty("--bolt-x", `${12 + Math.random() * 76}vw`);
        bolt.style.setProperty("--bolt-delay", `${Math.random() * 1.25}s`);
        event.appendChild(bolt);
      }
    } else if (motif.pattern === "traveler" || motif.pattern === "rolling") {
      for (let i = 0; i < 3; i++) {
        const traveler = document.createElement("div");
        traveler.className = `ambient-traveler${motif.pattern === "rolling" ? " is-rolling" : ""}`;
        traveler.style.setProperty("--travel-y", `${48 + Math.random() * 31}vh`);
        traveler.style.setProperty("--actor-delay", `${Math.random() * 3.2}s`);
        traveler.style.setProperty("--actor-duration", `${10.5 + Math.random() * 5}s`);
        traveler.style.setProperty("--fast-delay", `${Math.random() * 1.25}s`);
        traveler.style.setProperty("--fast-duration", `${2.2 + Math.random() * 1.7}s`);
        traveler.style.setProperty("--travel-mid-x", `${39 + Math.random() * 16}vw`);
        traveler.style.setProperty("--travel-rise", `${-15 + Math.random() * 25}px`);
        traveler.style.setProperty("--travel-end-y", `${-12 + Math.random() * 24}px`);
        traveler.style.color = motif.color;
        const glyph = document.createElement("span");
        glyph.className = "ambient-glyph";
        glyph.textContent = motif.glyph;
        traveler.appendChild(glyph);
        event.appendChild(traveler);
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const bloom = document.createElement("div");
        bloom.className = "ambient-bloom";
        bloom.style.setProperty("--x", `${18 + Math.random() * 64}vw`);
        bloom.style.setProperty("--y", `${24 + Math.random() * 52}vh`);
        bloom.style.setProperty("--motif-color", motif.color);
        bloom.style.setProperty("--actor-delay", `${Math.random() * 3}s`);
        bloom.style.setProperty("--actor-duration", `${8 + Math.random() * 5}s`);
        bloom.style.setProperty("--fast-delay", `${Math.random() * 1.2}s`);
        bloom.style.setProperty("--fast-duration", `${2.15 + Math.random() * 1.65}s`);
        bloom.style.setProperty("--bloom-rise", `${-8 - Math.random() * 18}%`);
        bloom.style.setProperty("--bloom-tilt", `${-8 + Math.random() * 16}deg`);
        const glyph = document.createElement("span");
        glyph.className = "ambient-glyph";
        glyph.textContent = motif.glyph;
        bloom.appendChild(glyph);
        event.appendChild(bloom);
      }
    }

    animationLayer.appendChild(event);
    showEventPanel("半時の演出", motif.label, instant, timeZone, motif.color);
    removeAfterAnimation(event, state.fastForward ? 6200 : 16000);
  }

  function resetAnimationClock() {
    animationClock.lastInstantMs = null;
  }

  function processTimedAnimations(instant, cycle, timeZone) {
    const nowMs = instant.getTime();
    const previousMs = animationClock.lastInstantMs;
    animationClock.lastInstantMs = nowMs;
    if (!state.animationsEnabled || previousMs == null) return;

    const elapsed = nowMs - previousMs;
    // 日付・場所の手動変更や長時間の休止では、過去イベントをまとめて再生しない。
    if (elapsed <= 0 || elapsed > 45 * 60 * 1000) return;

    const crossedEvents = [];
    cycle.boundaries.forEach((boundary, index) => {
      const startMs = boundary.time.getTime();
      const halfMs = startMs + boundary.periodMs / 2;
      if (previousMs < startMs && startMs <= nowMs) {
        crossedEvents.push({ time: startMs, type: "zodiac", boundary });
      }
      if (previousMs < halfMs && halfMs <= nowMs) {
        crossedEvents.push({ time: halfMs, type: "ambient", isDay: index < 6 });
      }
    });

    crossedEvents.sort((a, b) => a.time - b.time).forEach((event) => {
      const eventInstant = new Date(event.time);
      if (event.type === "zodiac") {
        showZodiacAnimation(event.boundary, eventInstant, timeZone);
        ringTimeBell(event.boundary.bellNum);
      } else {
        showAmbientAnimation(chooseAmbientMotif(eventInstant, event.isDay, timeZone), eventInstant, timeZone);
      }
    });
  }

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
    const dayKokuMs = dayLenMs / 6;
    const nightKokuMs = nightLenMs / 6;
    const dayKokuText = fmtDuration(dayKokuMs);
    const nightKokuText = fmtDuration(nightKokuMs);
    $("dayKokuLen").textContent = dayKokuText;
    $("nightKokuLen").textContent = nightKokuText;
    $("dayKokuCompact").textContent = dayKokuText.replace("約", "");
    $("nightKokuCompact").textContent = nightKokuText.replace("約", "");

    // 昼夜それぞれの一刻の長さを、合計4時間に対する比率として可視化する。
    // 日付スライダーを動かすと文字盤と同時に伸縮し、不定時法の季節差を直感的に示す。
    const dayRatio = (dayKokuMs / (dayKokuMs + nightKokuMs)) * 100;
    $("dayKokuBar").style.width = `${dayRatio}%`;
    $("nightKokuBar").style.width = `${100 - dayRatio}%`;
    $("dayKokuBar").parentElement.setAttribute(
      "aria-label",
      `昼の一刻は${dayKokuText}、夜の一刻は${nightKokuText}`
    );
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
      $("sunriseTime").textContent = "―";
      $("sunsetTime").textContent = "―";
      $("dayKokuLen").textContent = "―";
      $("nightKokuLen").textContent = "―";
      $("dayKokuCompact").textContent = "―";
      $("nightKokuCompact").textContent = "―";
      $("dayKokuBar").style.width = "50%";
      $("nightKokuBar").style.width = "50%";
      $("dayKokuBar").parentElement.setAttribute(
        "aria-label",
        "白夜または極夜のため、一刻の長さを比較できません"
      );
      animationClock.lastInstantMs = instant.getTime();
      return;
    }

    const cycle = buildWadokeiCycle(sunYesterday, sunToday, sunTomorrow, instant);
    const nowHourAngle = angleForHour(getLocalHourFloat(instant, loc.timeZone));

    renderClockFace(cycle, nowHourAngle, loc.timeZone);
    updateInfoPanel(cycle, sunToday, sunTomorrow, loc.timeZone);
    processTimedAnimations(instant, cycle, loc.timeZone);
  }

  function currentInstant() {
    if (state.fastForward) {
      const elapsedReal = performance.now() - state.fastForward.startPerf;
      const simMs =
        state.fastForward.simStart.getTime() + elapsedReal * state.fastForward.speed;
      return new Date(simMs);
    }
    return new Date(Date.now() + state.dateOffsetDays * 86400000);
  }

  function tick() {
    const instant = currentInstant();

    if (state.fastForward) {
      const elapsedMs = instant - state.fastForward.simStart;
      if (elapsedMs >= ONE_DAY_MS) {
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
    // 選択中の日付における「現在時刻」から始め、実時間36秒でちょうど24時間進める。
    const simStart = new Date(Date.now() + state.dateOffsetDays * ONE_DAY_MS);
    const speed = ONE_DAY_MS / FAST_FORWARD_REAL_DURATION_MS;
    state.fastForward = { startPerf: performance.now(), simStart, speed };
    resetAnimationClock();
    playBtn.textContent = "早送り再生を停止 ■";
    playBtn.classList.add("is-playing");
    restartTicking();
  }

  function stopFastForward() {
    state.fastForward = null;
    resetAnimationClock();
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
  const modernClockToggle = $("modernClockToggle");

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
    resetAnimationClock();
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
    resetAnimationClock();
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
   * 10. 現代時計オーバーレイの切り替え
   * ------------------------------------------------------------------- */

  function toggleModernClock() {
    state.showModernClock = !state.showModernClock;
    modernClockToggle.classList.toggle("is-active", state.showModernClock);
    modernClockToggle.setAttribute("aria-pressed", String(state.showModernClock));
    render(currentInstant());
  }

  modernClockToggle.addEventListener("click", toggleModernClock);
  // 文字盤そのものをクリックする従来の操作も残す。
  svg.addEventListener("click", toggleModernClock);

  animationToggle.addEventListener("click", () => {
    state.animationsEnabled = !state.animationsEnabled;
    animationToggle.classList.toggle("is-active", state.animationsEnabled);
    animationToggle.setAttribute("aria-pressed", String(state.animationsEnabled));
    animationToggleLabel.textContent = `演出 ${state.animationsEnabled ? "ON" : "OFF"}`;
    animationLayer.replaceChildren();
    eventPanels.forEach((panel) => panel.classList.remove("is-visible"));
    resetAnimationClock();
  });

  bellToggle.addEventListener("click", () => {
    state.bellsEnabled = !state.bellsEnabled;
    bellToggle.classList.toggle("is-active", state.bellsEnabled);
    bellToggle.setAttribute("aria-pressed", String(state.bellsEnabled));
    bellToggleLabel.textContent = `鐘 ${state.bellsEnabled ? "ON" : "OFF"}`;
    if (state.bellsEnabled) ensureAudioContext();
    else stopTimeBells();
  });

  /* ------------------------------------------------------------------- *
   * 11. 初期化
   * ------------------------------------------------------------------- */

  dateLabel.textContent = formatSimulatedDateLabel();
  startTicking();
})();
