"use strict";

const SiteDetector = {
    SITES: {
        LINUX_DO: "linux_do",
        NOTION: "notion",
        GITHUB: "github",
        ZHIHU: "zhihu",
        GENERIC: "generic",
    },

    // 检测当前站点（精确匹配，防止域名仿冒）
    detect: () => {
        const hostname = window.location.hostname;
        if (hostname === "linux.do" || hostname.endsWith(".linux.do")) {
            return SiteDetector.SITES.LINUX_DO;
        }
        if (hostname === "notion.so" || hostname === "www.notion.so" || hostname.endsWith(".notion.so")) {
            return SiteDetector.SITES.NOTION;
        }
        if (hostname === "github.com" || hostname === "www.github.com") {
            return SiteDetector.SITES.GITHUB;
        }
        if (hostname === "www.zhihu.com" || hostname === "zhuanlan.zhihu.com") {
            return SiteDetector.SITES.ZHIHU;
        }
        return SiteDetector.SITES.GENERIC;
    },

    // 判断是否在 Linux.do 站点
    isLinuxDo: () => {
        return SiteDetector.detect() === SiteDetector.SITES.LINUX_DO;
    },

    // 判断是否在 Notion 站点
    isNotion: () => {
        return SiteDetector.detect() === SiteDetector.SITES.NOTION;
    },

    // 判断是否在 GitHub 站点
    isGitHub: () => {
        return SiteDetector.detect() === SiteDetector.SITES.GITHUB;
    },

    // 判断是否在通用网页
    isGeneric: () => {
        return SiteDetector.detect() === SiteDetector.SITES.GENERIC;
    },
};

const InstallHelper = {
    BOOKMARK_EXTENSION_URL: "https://github.com/Smith-106/LD-Notion/releases/latest",

    getBookmarkExtensionUrl: () => InstallHelper.BOOKMARK_EXTENSION_URL,

    renderInstallLink: (label = "一键安装浏览器扩展") => {
        const url = InstallHelper.getBookmarkExtensionUrl();
        return `<a href="${url}" target="_blank" class="ldb-link">${label}</a>`;
    },

    openBookmarkExtensionInstall: () => {
        window.open(InstallHelper.getBookmarkExtensionUrl(), "_blank", "noopener,noreferrer");
    },
};


const EMOJI_MAP = {
    // 笑脸表情
    grinning_face: "😀", smiley: "😃", grin: "😁", joy: "😂", rofl: "🤣",
    smile: "😊", blush: "😊", wink: "😉", heart_eyes: "😍", kissing_heart: "😘",
    thinking: "🤔", face_with_raised_eyebrow: "🤨", neutral_face: "😐", expressionless: "😑",
    unamused: "😒", roll_eyes: "🙄", grimacing: "😬", lying_face: "🤥",
    relieved: "😌", pensive: "😔", sleepy: "😪", drooling_face: "🤤", sleeping: "😴",
    mask: "😷", face_with_thermometer: "🤒", nauseated_face: "🤢", sneezing_face: "🤧",
    cold_face: "🥶", hot_face: "🥵", woozy_face: "🥴", exploding_head: "🤯",
    cowboy_hat_face: "🤠", partying_face: "🥳", sunglasses: "😎", nerd_face: "🤓",
    confused: "😕", worried: "😟", frowning: "☹️", open_mouth: "😮", hushed: "😯",
    astonished: "😲", flushed: "😳", pleading_face: "🥺", cry: "😢", sob: "😭",
    scream: "😱", angry: "😠", rage: "😡", skull: "💀", poop: "💩",
    clown_face: "🤡", ghost: "👻", alien: "👽", robot: "🤖",
    // 手势
    thumbsup: "👍", thumbsdown: "👎", "+1": "👍", "-1": "👎",
    ok_hand: "👌", pinched_fingers: "🤌", pinching_hand: "🤏",
    victory_hand: "✌️", v: "✌️", crossed_fingers: "🤞", love_you_gesture: "🤟",
    metal: "🤘", call_me_hand: "🤙", point_left: "👈", point_right: "👉",
    point_up: "👆", point_down: "👇", raised_hand: "✋", wave: "👋",
    clap: "👏", raised_hands: "🙌", open_hands: "👐", palms_up_together: "🤲",
    handshake: "🤝", pray: "🙏", muscle: "💪", punch: "👊", fist: "✊",
    // 心形
    heart: "❤️", orange_heart: "🧡", yellow_heart: "💛", green_heart: "💚",
    blue_heart: "💙", purple_heart: "💜", black_heart: "🖤", white_heart: "🤍",
    broken_heart: "💔", sparkling_heart: "💖", heartpulse: "💗", heartbeat: "💓",
    revolving_hearts: "💞", two_hearts: "💕", heart_exclamation: "❣️",
    // 符号
    fire: "🔥", star: "⭐", star2: "🌟", sparkles: "✨", zap: "⚡",
    check: "✅", white_check_mark: "✅", x: "❌", cross_mark: "❌",
    warning: "⚠️", question: "❓", exclamation: "❗", no_entry: "⛔",
    rocket: "🚀", bulb: "💡", book: "📖", bookmark: "🔖",
    "100": "💯", boom: "💥", collision: "💥", dizzy: "💫",
    speech_balloon: "💬", thought_balloon: "💭", zzz: "💤",
    // 动物
    dog: "🐕", cat: "🐱", mouse: "🐭", rabbit: "🐰", fox: "🦊",
    bear: "🐻", panda: "🐼", koala: "🐨", tiger: "🐯", lion: "🦁",
    cow: "🐮", pig: "🐷", frog: "🐸", monkey: "🐒", chicken: "🐔",
    penguin: "🐧", bird: "🐦", eagle: "🦅", owl: "🦉", bat: "🦇",
    // 食物
    apple: "🍎", banana: "🍌", orange: "🍊", lemon: "🍋", grapes: "🍇",
    watermelon: "🍉", strawberry: "🍓", peach: "🍑", pizza: "🍕", hamburger: "🍔",
    coffee: "☕", tea: "🍵", beer: "🍺", wine_glass: "🍷", cake: "🍰",
    // 物品
    gift: "🎁", balloon: "🎈", tada: "🎉", trophy: "🏆", medal_sports: "🏅",
    first_place_medal: "🥇", second_place_medal: "🥈", third_place_medal: "🥉",
    computer: "💻", keyboard: "⌨️", phone: "📱", email: "📧", memo: "📝",
    lock: "🔒", unlock: "🔓", key: "🔑", gear: "⚙️", hammer: "🔨",
    // 交通与天气
    car: "🚗", airplane: "✈️", sun: "☀️", cloud: "☁️", umbrella: "☂️",
    rainbow: "🌈", snowflake: "❄️", globe_showing_asia_australia: "🌏",
    // 杂项
    eyes: "👀", eye: "👁️", brain: "🧠", tongue: "👅", lips: "👄",
    baby: "👶", man: "👨", woman: "👩", family: "👪",
    clock: "🕐", hourglass: "⌛", stopwatch: "⏱️",
};

// ===========================================

const NOTION_LANGUAGES = new Set([
    "javascript", "typescript", "python", "java", "c", "c++", "c#", "go", "rust",
    "ruby", "php", "swift", "kotlin", "scala", "html", "css", "sql", "shell",
    "bash", "powershell", "json", "yaml", "xml", "markdown", "plain text"
]);

const normalizeLanguage = (lang) => {
    if (!lang) return "plain text";
    const lower = lang.toLowerCase().trim();
    if (NOTION_LANGUAGES.has(lower)) return lower;

    const aliases = {
        js: "javascript", ts: "typescript", py: "python",
        rb: "ruby", sh: "shell", yml: "yaml", md: "markdown",
        cpp: "c++", csharp: "c#", cs: "c#", golang: "go", rs: "rust",
    };
    return aliases[lower] || "plain text";
};

module.exports = { SiteDetector, InstallHelper, EMOJI_MAP, NOTION_LANGUAGES, normalizeLanguage };
