
/* =========================================================
   ARENA — FIREBASE MULTIPLAYER
   TIC-TAC-TOE
   Stable multiplayer + AI fallback + disconnect handling
   UI / HTML / CSS untouched
   ========================================================= */


/* =========================================================
   FIREBASE CONFIG
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyALkP001EFoAmixfUDHG6dr8rPLY5jZyBU",
  authDomain: "online-multiplayer-game-87d66.firebaseapp.com",
  databaseURL:
    "https://online-multiplayer-game-87d66-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "online-multiplayer-game-87d66",
  storageBucket: "online-multiplayer-game-87d66.firebasestorage.app",
  messagingSenderId: "448318086824",
  appId: "1:448318086824:web:74c57d238eddced1332c9d",
  measurementId: "G-EZ5SBVLWWZ",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.database();


/* =========================================================
   CONSTANTS
   ========================================================= */

const AVATARS = [
  "🦁",
  "🐯",
  "🐉",
  "🦅",
  "🦊",
  "🐺",
  "🐸",
  "🦖",
  "🐙",
  "🦈",
  "🐧",
  "🦄",
];

const RANKS = [
  { min: 0, name: "Rookie", badge: "🎮" },
  { min: 500, name: "Fighter", badge: "⚔️" },
  { min: 1000, name: "Warrior", badge: "⚡" },
  { min: 1600, name: "Champion", badge: "🔥" },
  { min: 2200, name: "Legend", badge: "👑" },
];

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const MATCH_WAIT_TIME = 30;


/* =========================================================
   GLOBAL STATE
   ========================================================= */

let myId = null;
let myProfile = null;

let currentRoomId = null;
let mySymbol = null;

let roomListener = null;
let queueListener = null;
let privateRoomListener = null;
let opponentPresenceListener = null;

let presenceRef = null;
let roomPresenceRef = null;

let resultHandled = false;
let lastRoomState = "";

let searchTimer = null;
let searchStartedAt = null;

let aiGame = null;
let aiMoveTimer = null;

/* =========================================================
   BASIC HELPERS
   ========================================================= */

function rankFor(xp) {
  let rank = RANKS[0];

  for (const item of RANKS) {
    if (xp >= item.min) {
      rank = item;
    }
  }

  return rank;
}


function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value || "";
  return div.innerHTML;
}


function getOpponentSymbol(symbol) {
  return symbol === "X" ? "O" : "X";
}


function getPlayer(room, symbol) {
  return room?.players?.[symbol] || null;
}


/* =========================================================
   NAVIGATION
   ========================================================= */

function showScreen(name) {
  document
    .querySelectorAll(".screen")
    .forEach((screen) => {
      screen.classList.remove("active");
    });

  const target = document.getElementById("screen-" + name);

  if (target) {
    target.classList.add("active");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}


/* =========================================================
   NAVIGATION
   ========================================================= */

async function goHome() {
  stopSearchTimer();
  cleanupQueueListener();
  stopAI();

  /*
     If currently inside a multiplayer room,
     explicitly leave it.
  */

  if (currentRoomId && myId) {
    await leaveCurrentRoom();
  }

  cleanupRoomListener();
  cleanupPrivateRoomListener();
  stopOpponentPresenceListener();

  currentRoomId = null;
  mySymbol = null;
  lastRoomState = "";
  resultHandled = false;

  showScreen("home");
}


async function openGameMenu() {
  stopSearchTimer();
  cleanupQueueListener();
  stopAI();

  if (currentRoomId && myId) {
    await leaveCurrentRoom();
  }

  cleanupRoomListener();
  cleanupPrivateRoomListener();
  stopOpponentPresenceListener();

  currentRoomId = null;
  mySymbol = null;

  showScreen("gamemenu");
}

/* =========================================================
   TOAST / NOTIFICATION
   ========================================================= */

function showNotification(message) {
  let toast = document.getElementById("arenaToast");

  if (!toast) {
    toast = document.createElement("div");

    toast.id = "arenaToast";

    toast.style.position = "fixed";
    toast.style.left = "50%";
    toast.style.bottom = "28px";
    toast.style.transform = "translateX(-50%)";
    toast.style.zIndex = "9999";
    toast.style.background = "#1a1740";
    toast.style.color = "#f4f2ff";
    toast.style.border = "1px solid rgba(255,255,255,.12)";
    toast.style.borderRadius = "14px";
    toast.style.padding = "13px 18px";
    toast.style.fontSize = "14px";
    toast.style.fontWeight = "600";
    toast.style.boxShadow = "0 12px 30px rgba(0,0,0,.4)";
    toast.style.maxWidth = "90%";
    toast.style.textAlign = "center";
    toast.style.opacity = "0";
    toast.style.transition = "opacity .2s ease";

    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.opacity = "1";

  clearTimeout(toast._timer);

  toast._timer = setTimeout(() => {
    toast.style.opacity = "0";
  }, 3500);
}


/* =========================================================
   PROFILE
   ========================================================= */

function renderAvatarPicker() {
  const container = document.getElementById("avatarPick");

  if (!container) return;

  container.innerHTML = "";

  AVATARS.forEach((avatar, index) => {
    const option = document.createElement("div");

    option.className =
      "avatar-opt" + (index === 0 ? " selected" : "");

    option.textContent = avatar;

    option.onclick = () => {
      document
        .querySelectorAll(".avatar-opt")
        .forEach((item) => {
          item.classList.remove("selected");
        });

      option.classList.add("selected");
    };

    container.appendChild(option);
  });
}


async function saveProfile() {
  if (!myId) return;

  const input = document.getElementById("setupName");

  const name =
    input?.value.trim() ||
    "Player" + Math.floor(Math.random() * 9999);

  const selected =
    document.querySelector(".avatar-opt.selected");

  const avatar =
    selected?.textContent || AVATARS[0];

  const old = myProfile || {};

  myProfile = {
    id: myId,
    name,
    avatar,
    xp: Number(old.xp || 0),
    wins: Number(old.wins || 0),
    losses: Number(old.losses || 0),
    draws: Number(old.draws || 0),
    played: Number(old.played || 0),
  };

  localStorage.setItem(
    "arenaProfile",
    JSON.stringify(myProfile)
  );

  try {
    await db.ref("players/" + myId).set(myProfile);
  } catch (error) {
    console.error("Save profile error:", error);

    alert(
      "Could not save profile: " +
        error.message
    );

    return;
  }

  const overlay =
    document.getElementById("setupOverlay");

  if (overlay) {
    overlay.style.display = "none";
  }

  applyProfileToNav();
  refreshLeaderboardData();
}


function editProfile() {
  if (!myProfile) return;

  const overlay =
    document.getElementById("setupOverlay");

  if (overlay) {
    overlay.style.display = "flex";
  }

  const input =
    document.getElementById("setupName");

  if (input) {
    input.value = myProfile.name || "";
  }

  renderAvatarPicker();

  document
    .querySelectorAll(".avatar-opt")
    .forEach((item) => {
      item.classList.toggle(
        "selected",
        item.textContent === myProfile.avatar
      );
    });
}


function applyProfileToNav() {
  if (!myProfile) return;

  const avatar =
    document.getElementById("navAvatar");

  const name =
    document.getElementById("navName");

  if (avatar) {
    avatar.textContent =
      myProfile.avatar || "🎮";
  }

  if (name) {
    name.textContent =
      myProfile.name || "Player";
  }

  renderProfileScreen();
}


/* =========================================================
   PRESENCE
   ========================================================= */

function startPresence() {
  if (!myId) return;

  presenceRef =
    db.ref("presence/" + myId);

  presenceRef.set({
    name: myProfile?.name || "Player",
    avatar: myProfile?.avatar || "🎮",
    online: true,
    lastSeen:
      firebase.database.ServerValue.TIMESTAMP,
  });

  presenceRef.onDisconnect().remove();

  refreshOnlineCount();

  setInterval(
    refreshOnlineCount,
    10000
  );
}


async function refreshOnlineCount() {
  try {
    const snapshot =
      await db.ref("presence").once("value");

    const now = Date.now();

    let count = 0;

    snapshot.forEach((child) => {
      const data = child.val();

      if (
        data?.online &&
        data.lastSeen &&
        now - data.lastSeen < 30000
      ) {
        count++;
      }
    });

    count = Math.max(count, 1);

    const onlineCount =
      document.getElementById("onlineCount");

    const heroOnline =
      document.getElementById("heroOnline");

    if (onlineCount) {
      onlineCount.textContent = count;
    }

    if (heroOnline) {
      heroOnline.textContent = count;
    }
  } catch (error) {
    console.error(
      "Online count error:",
      error
    );
  }
}


/* =========================================================
   LEADERBOARD
   ========================================================= */

async function fetchLeaderboard() {
  try {
    const snapshot =
      await db.ref("players").once("value");

    const players = [];

    snapshot.forEach((child) => {
      const player = child.val();

      if (player) {
        players.push(player);
      }
    });

    players.sort(
      (a, b) =>
        Number(b.xp || 0) -
        Number(a.xp || 0)
    );

    return players;
  } catch (error) {
    console.error(
      "Leaderboard error:",
      error
    );

    return [];
  }
}


async function refreshLeaderboardData() {
  const entries =
    await fetchLeaderboard();

  const preview =
    document.getElementById("lbPreview");

  const full =
    document.getElementById("lbFull");

  if (preview) {
    renderLbList(
      entries,
      preview,
      5
    );
  }

  if (full) {
    renderLbList(
      entries,
      full,
      50
    );
  }

  const totalMatches =
    entries.reduce(
      (sum, player) =>
        sum + Number(player.played || 0),
      0
    );

  const heroMatches =
    document.getElementById("heroMatches");

  const heroTop =
    document.getElementById("heroTop");

  if (heroMatches) {
    heroMatches.textContent =
      totalMatches;
  }

  if (heroTop) {
    heroTop.textContent =
      entries.length
        ? Number(entries[0].xp || 0)
        : 0;
  }

  renderProfileScreen(entries);
}


function medalFor(index) {
  if (index === 0) return "👑";
  if (index === 1) return "🔥";
  if (index === 2) return "⚡";

  return "🎮";
}


function renderLbList(
  entries,
  container,
  limit
) {
  if (!container) return;

  if (!entries.length) {
    container.innerHTML =
      `<div style="
        padding:20px;
        color:var(--ink-dim);
        font-size:13px;
      ">
        No players yet — be the first to compete!
      </div>`;

    return;
  }

  container.innerHTML = "";

  entries
    .slice(0, limit)
    .forEach((player, index) => {
      const row =
        document.createElement("div");

      row.className =
        "lb-row" +
        (player.id === myId
          ? " me"
          : "");

      const played =
        Number(player.played || 0);

      const wins =
        Number(player.wins || 0);

      const winPct =
        played
          ? Math.round(
              (wins / played) * 100
            )
          : 0;

      row.innerHTML = `
        <div class="lb-rank">
          ${index + 1}
        </div>

        <div class="lb-avatar">
          ${escapeHtml(
            player.avatar || "🎮"
          )}
        </div>

        <div class="lb-name">
          ${medalFor(index)}
          ${escapeHtml(
            player.name || "Player"
          )}

          <div class="lb-sub">
            ${played} played ·
            ${winPct}% win rate
          </div>
        </div>

        <div class="lb-xp">
          ${Number(player.xp || 0)} XP
        </div>
      `;

      container.appendChild(row);
    });
}


async function renderProfileScreen(
  entriesMaybe
) {
  if (!myProfile) return;

  const entries =
    entriesMaybe ||
    (await fetchLeaderboard());

  const mine =
    entries.find(
      (player) =>
        player.id === myId
    ) || myProfile;

  const setText = (id, value) => {
    const element =
      document.getElementById(id);

    if (element) {
      element.textContent = value;
    }
  };

  setText(
    "profAvatar",
    mine.avatar || "🎮"
  );

  setText(
    "profName",
    mine.name || "Player"
  );

  const rank =
    rankFor(Number(mine.xp || 0));

  setText(
    "profRank",
    rank.badge + " " + rank.name
  );

  setText(
    "statXp",
    Number(mine.xp || 0)
  );

  setText(
    "statPlayed",
    Number(mine.played || 0)
  );

  setText(
    "statWins",
    Number(mine.wins || 0)
  );

  setText(
    "statLosses",
    Number(mine.losses || 0)
  );

  const played =
    Number(mine.played || 0);

  const wins =
    Number(mine.wins || 0);

  setText(
    "statWinPct",
    (played
      ? Math.round(
          (wins / played) * 100
        )
      : 0) + "%"
  );

  const index =
    entries.findIndex(
      (player) =>
        player.id === myId
    );

  setText(
    "statGlobalRank",
    index >= 0
      ? "#" + (index + 1)
      : "–"
  );
}


/* =========================================================
   MATCH TIMER
   ========================================================= */

function startSearchTimer() {
  stopSearchTimer();

  searchStartedAt = Date.now();

  updateSearchTimer();

  searchTimer = setInterval(
    updateSearchTimer,
    250
  );
}


function stopSearchTimer() {
  if (searchTimer) {
    clearInterval(searchTimer);
    searchTimer = null;
  }

  searchStartedAt = null;
}


function updateSearchTimer() {
  if (!searchStartedAt) return;

  const elapsed =
    Math.floor(
      (Date.now() - searchStartedAt) /
        1000
    );

  const remaining =
    Math.max(
      0,
      MATCH_WAIT_TIME - elapsed
    );

  const searchSub =
    document.getElementById("searchSub");

  if (searchSub) {
    searchSub.textContent =
      remaining > 0
        ? `Looking for an opponent… ${remaining}s`
        : "Starting practice match…";
  }

  if (remaining <= 0) {
    stopSearchTimer();
    startAIMatch();
  }
}


/* =========================================================
   QUICK MATCH
   ========================================================= */

async function startQuickMatch() {
  if (!myId || !myProfile) {
    alert(
      "Please finish your profile first."
    );

    return;
  }

  stopAI();
  cleanupQueueListener();
  cleanupRoomListener();
  stopOpponentPresenceListener();

  currentRoomId = null;
  mySymbol = null;

  showScreen("searching");

  const searchSub =
    document.getElementById("searchSub");

  if (searchSub) {
    searchSub.textContent =
      "Looking for an opponent… 30s";
  }

  startSearchTimer();

  const queueRef =
    db.ref("queues/tictactoe");

  const roomId =
    "r_" +
    Math.random()
      .toString(36)
      .slice(2, 10);

  try {
    const transaction =
      await queueRef.transaction(
        (current) => {

          /*
             Nobody waiting.
          */

          if (!current) {
            return {
              status: "waiting",

              player: {
                id: myId,
                name: myProfile.name,
                avatar: myProfile.avatar,
              },

              ts:
                firebase.database
                  .ServerValue
                  .TIMESTAMP,
            };
          }


          /*
             Someone waiting.
          */

          if (
            current.status === "waiting" &&
            current.player &&
            current.player.id !== myId
          ) {
            return {
              status: "matched",

              roomId,

              creatorId: myId,

              creator: {
                id: myId,
                name: myProfile.name,
                avatar: myProfile.avatar,
              },

              opponent: current.player,

              ts:
                firebase.database
                  .ServerValue
                  .TIMESTAMP,
            };
          }

          return current;
        }
      );

    if (!transaction.committed) {
      await waitForMatch();
      return;
    }

    const state =
      transaction.snapshot.val();

    if (!state) {
      await waitForMatch();
      return;
    }


    /*
       We created the match.
    */

    if (
      state.status === "matched" &&
      state.creatorId === myId &&
      state.opponent
    ) {
      stopSearchTimer();

      await createMatchFromWaitingPlayer(
        state.opponent,
        state.roomId
      );

      return;
    }


    /*
       We are waiting.
    */

    await waitForMatch();

  } catch (error) {
    console.error(
      "Quick match error:",
      error
    );

    stopSearchTimer();

    if (searchSub) {
      searchSub.textContent =
        "Unable to connect. Please try again.";
    }

    alert(
      "Matchmaking error: " +
        error.message
    );
  }
}


/* =========================================================
   WAIT FOR MATCH
   ========================================================= */

async function waitForMatch() {
  cleanupQueueListener();

  const queueRef =
    db.ref("queues/tictactoe");

  const checkQueue =
    async (snapshot) => {

      const state =
        snapshot.val();


      if (!state) {
        return;
      }


      if (
        state.status === "matched" &&
        state.roomId &&
        state.creator &&
        state.opponent
      ) {
        const isCreator =
          state.creatorId === myId;

        const isOpponent =
          state.opponent.id === myId;

        if (!isCreator && !isOpponent) {
          return;
        }

        stopSearchTimer();
        cleanupQueueListener();


        /*
           Creator makes room.
        */

        if (isCreator) {
          await createMatchFromWaitingPlayer(
            state.opponent,
            state.roomId
          );

          return;
        }


        /*
           Waiting player waits.
        */

        await waitForRoomAndEnter(
          state.roomId,
          "X"
        );
      }
    };


  queueListener = {
    ref: queueRef,
    callback: checkQueue,
  };

  queueRef.on(
    "value",
    checkQueue
  );


  const immediate =
    await queueRef.once("value");

  await checkQueue(immediate);
}


/* =========================================================
   CREATE MATCH
   ========================================================= */

async function createMatchFromWaitingPlayer(
  opponent,
  roomId
) {
  if (
    !opponent?.id ||
    opponent.id === myId ||
    !roomId
  ) {
    return;
  }

  stopSearchTimer();

  /*
     X = waiting player
     O = creator
  */

  const room = {
    id: roomId,

    game: "tictactoe",

    players: {
      X: {
        id: opponent.id,
        name: opponent.name,
        avatar: opponent.avatar,
      },

      O: {
        id: myId,
        name: myProfile.name,
        avatar: myProfile.avatar,
      },
    },

    board: Array(9).fill(null),

    turn: opponent.id,

    status: "active",

    winner: null,

    winLine: null,

    moveCount: 0,

    createdAt:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  };

  try {
    await db
      .ref("rooms/" + roomId)
      .set(room);


    /*
       Direct match reference.
    */

    await db
      .ref("matched/" + opponent.id)
      .set(roomId);


    /*
       Remove queue.
    */

    await db
      .ref("queues/tictactoe")
      .transaction((current) => {

        if (
          current &&
          current.status === "matched" &&
          current.roomId === roomId
        ) {
          return null;
        }

        return current;
      });


    await enterRoom(
      roomId,
      "O"
    );

  } catch (error) {
    console.error(
      "Create match error:",
      error
    );
  }
}


/* =========================================================
   WAIT FOR CREATED ROOM
   ========================================================= */

async function waitForRoomAndEnter(
  roomId,
  symbol
) {
  const roomRef =
    db.ref("rooms/" + roomId);

  const handler =
    async (snapshot) => {

      if (!snapshot.exists()) {
        return;
      }

      const room =
        snapshot.val();

      if (
        room?.status === "active" &&
        room.players?.X &&
        room.players?.O
      ) {
        roomRef.off(
          "value",
          handler
        );

        stopSearchTimer();

        await enterRoom(
          roomId,
          symbol
        );
      }
    };

  roomRef.on(
    "value",
    handler
  );

  const immediate =
    await roomRef.once("value");

  await handler(immediate);
}


/* =========================================================
   QUEUE CLEANUP
   ========================================================= */

function cleanupQueueListener() {
  if (
    queueListener?.ref &&
    queueListener?.callback
  ) {
    queueListener.ref.off(
      "value",
      queueListener.callback
    );
  }

  queueListener = null;
}


async function cancelSearch() {
  stopSearchTimer();
  cleanupQueueListener();

  if (!myId) {
    showScreen("gamemenu");
    return;
  }

  try {

    await db
      .ref("queues/tictactoe")
      .transaction((current) => {

        if (
          current &&
          current.status === "waiting" &&
          current.player?.id === myId
        ) {
          return null;
        }

        return current;
      });

    await db
      .ref("matched/" + myId)
      .remove();

  } catch (error) {
    console.error(
      "Cancel search error:",
      error
    );
  }

  showScreen("gamemenu");
}


/* =========================================================
   PRIVATE ROOM
   ========================================================= */

function genCode() {
  return Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();
}


async function createPrivateRoom() {
  if (!myId || !myProfile) {
    alert(
      "Please finish your profile first."
    );

    return;
  }

  stopAI();
  stopSearchTimer();

  let code = null;
  let roomId = null;

  for (
    let attempt = 0;
    attempt < 10;
    attempt++
  ) {
    const candidate =
      genCode();

    const candidateRef =
      db.ref(
        "rooms/priv_" +
          candidate
      );

    const snapshot =
      await candidateRef.once(
        "value"
      );

    if (!snapshot.exists()) {
      code = candidate;
      roomId =
        "priv_" + candidate;
      break;
    }
  }

  if (!code || !roomId) {
    alert(
      "Could not generate a room code. Try again."
    );

    return;
  }

  const room = {
    id: roomId,

    game: "tictactoe",

    code,

    players: {
      X: {
        id: myId,
        name: myProfile.name,
        avatar: myProfile.avatar,
      },

      O: null,
    },

    board: Array(9).fill(null),

    turn: myId,

    status: "waiting",

    winner: null,

    winLine: null,

    moveCount: 0,

    createdAt:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  };

  try {
    await db
      .ref("rooms/" + roomId)
      .set(room);

    currentRoomId = roomId;
    mySymbol = "X";

    const codeElement =
      document.getElementById(
        "privateRoomCode"
      );

    if (codeElement) {
      codeElement.textContent =
        code;
    }

    showScreen("privatewait");

    cleanupPrivateRoomListener();

    const roomRef =
      db.ref(
        "rooms/" + roomId
      );

    privateRoomListener =
      async (snapshot) => {

        if (!snapshot.exists()) {
          return;
        }

        const updated =
          snapshot.val();

        if (
          updated.status === "active" &&
          updated.players?.O
        ) {
          roomRef.off(
            "value",
            privateRoomListener
          );

          privateRoomListener = null;

          await enterRoom(
            roomId,
            "X"
          );
        }
      };

    roomRef.on(
      "value",
      privateRoomListener
    );

  } catch (error) {
    console.error(
      "Private room creation error:",
      error
    );

    alert(
      "Could not create room: " +
        error.message
    );
  }
}


function cleanupPrivateRoomListener() {
  if (
    privateRoomListener &&
    currentRoomId
  ) {
    db
      .ref(
        "rooms/" +
          currentRoomId
      )
      .off(
        "value",
        privateRoomListener
      );
  }

  privateRoomListener = null;
}


/* =========================================================
   JOIN PRIVATE ROOM
   ========================================================= */

async function joinPrivateRoom() {
  if (!myId || !myProfile) {
    alert(
      "Please finish your profile first."
    );

    return;
  }

  const input =
    document.getElementById(
      "joinCodeInput"
    );

  const code =
    input?.value
      .trim()
      .toUpperCase();

  if (!code) {
    alert(
      "Enter a room code."
    );

    return;
  }

  const roomId =
    "priv_" + code;

  const roomRef =
    db.ref(
      "rooms/" + roomId
    );

  try {
    const transaction =
      await roomRef.transaction(
        (room) => {

          if (!room) {
            return;
          }

          if (
            room.status !==
            "waiting"
          ) {
            return;
          }

          if (
            room.players?.X?.id ===
            myId
          ) {
            return;
          }

          if (
            room.players?.O
          ) {
            return;
          }

          room.players.O = {
            id: myId,
            name: myProfile.name,
            avatar: myProfile.avatar,
          };

          room.status = "active";

          return room;
        }
      );

    if (
      !transaction.committed
    ) {
      const check =
        await roomRef.once(
          "value"
        );

      if (!check.exists()) {
        alert(
          "Room not found. Check the code and try again."
        );
      } else {
        alert(
          "This room is no longer available."
        );
      }

      return;
    }

    const room =
      transaction.snapshot.val();

    if (
      !room?.players?.O
    ) {
      alert(
        "Could not join this room."
      );

      return;
    }

    await enterRoom(
      roomId,
      "O"
    );

  } catch (error) {
    console.error(
      "Join room error:",
      error
    );

    alert(
      "Could not join room: " +
        error.message
    );
  }
}


/* =========================================================
   ENTER ROOM
   ========================================================= */

async function enterRoom(
  roomId,
  symbol
) {
  if (!roomId || !myId) {
    return;
  }

  stopAI();
  stopSearchTimer();

  cleanupRoomListener();
  cleanupPrivateRoomListener();

  currentRoomId = roomId;
  mySymbol = symbol;

  resultHandled = false;
  lastRoomState = "";

  try {
    const snapshot =
      await db
        .ref(
          "rooms/" + roomId
        )
        .once("value");

    if (!snapshot.exists()) {
      alert(
        "This match no longer exists."
      );

      showScreen("gamemenu");
      return;
    }

    const room =
      snapshot.val();

    const me =
      getPlayer(
        room,
        symbol
      );

    const opponentSymbol =
      getOpponentSymbol(
        symbol
      );

    const opponent =
      getPlayer(
        room,
        opponentSymbol
      );

    if (!me || !opponent) {
      alert(
        "Waiting for the second player."
      );

      return;
    }


    /*
       Match found UI.
    */

    const mfAvatar1 =
      document.getElementById(
        "mfAvatar1"
      );

    const mfName1 =
      document.getElementById(
        "mfName1"
      );

    const mfAvatar2 =
      document.getElementById(
        "mfAvatar2"
      );

    const mfName2 =
      document.getElementById(
        "mfName2"
      );

    if (mfAvatar1)
      mfAvatar1.textContent =
        me.avatar || "🎮";

    if (mfName1)
      mfName1.textContent =
        me.name || "Player";

    if (mfAvatar2)
      mfAvatar2.textContent =
        opponent.avatar || "🎮";

    if (mfName2)
      mfName2.textContent =
        opponent.name || "Player";

    showScreen("matchfound");


    /*
       Open game.
    */

    setTimeout(
      async () => {

        const latest =
          await db
            .ref(
              "rooms/" +
                roomId
            )
            .once("value");

        if (!latest.exists()) {
          return;
        }

        const latestRoom =
          latest.val();

        setupGameScreen(
          latestRoom,
          symbol
        );

        showScreen("game");

        startRoomListener(
  roomId
);

/*
   IMPORTANT:
   Announce ourselves as connected
   BEFORE listening for opponent disconnect.
*/

try {
  await markRoomPresence(roomId);
} catch (error) {
  console.error(
    "Could not mark room presence:",
    error
  );
}

startOpponentPresenceListener(
  roomId,
  opponent.id
);

      },
      1200
    );

  } catch (error) {
    console.error(
      "Enter room error:",
      error
    );
  }
}


/* =========================================================
   GAME SCREEN
   ========================================================= */

function setupGameScreen(
  room,
  symbol
) {
  const opponentSymbol =
    getOpponentSymbol(
      symbol
    );

  const me =
    getPlayer(
      room,
      symbol
    );

  const opponent =
    getPlayer(
      room,
      opponentSymbol
    );

  if (!me || !opponent) {
    return;
  }


  /*
     My player.
  */

  const meAvatar =
    document.getElementById(
      "meAvatar"
    );

  const meName =
    document.getElementById(
      "meName"
    );

  const meSymbol =
    document.getElementById(
      "meSymbol"
    );

  if (meAvatar)
    meAvatar.textContent =
      me.avatar || "🎮";

  if (meName)
    meName.textContent =
      me.name + " (You)";

  if (meSymbol) {
    meSymbol.textContent =
      symbol;

    meSymbol.style.color =
      symbol === "X"
        ? "var(--cyan)"
        : "var(--pink)";
  }


  /*
     Opponent.
  */

  const oppAvatar =
    document.getElementById(
      "oppAvatar"
    );

  const oppName =
    document.getElementById(
      "oppName"
    );

  const oppSymbol =
    document.getElementById(
      "oppSymbol"
    );

  if (oppAvatar)
    oppAvatar.textContent =
      opponent.avatar || "🎮";

  if (oppName)
    oppName.textContent =
      opponent.name ||
      "Opponent";

  if (oppSymbol) {
    oppSymbol.textContent =
      opponentSymbol;

    oppSymbol.style.color =
      opponentSymbol === "X"
        ? "var(--cyan)"
        : "var(--pink)";
  }


  /*
     XP.
  */

  Promise.all([
    db
      .ref(
        "players/" +
          me.id
      )
      .once("value"),

    db
      .ref(
        "players/" +
          opponent.id
      )
      .once("value"),
  ])
    .then(
      ([meSnapshot, opponentSnapshot]) => {

        const meData =
          meSnapshot.val();

        const opponentData =
          opponentSnapshot.val();

        const meXp =
          document.getElementById(
            "meXp"
          );

        const oppXp =
          document.getElementById(
            "oppXp"
          );

        if (meXp) {
          meXp.textContent =
            `${Number(
              meData?.xp || 0
            )} XP`;
        }

        if (oppXp) {
          oppXp.textContent =
            `${Number(
              opponentData?.xp || 0
            )} XP`;
        }
      }
    );

  renderBoard(
    room,
    symbol
  );
}


/* =========================================================
   BOARD
   ========================================================= */
/* =========================================================
   BOARD
   ========================================================= */

function renderBoard(room, symbol) {
  const board =
    document.getElementById("board");

  if (!board) {
    console.error(
      "ARENA: #board not found"
    );
    return;
  }

  board.innerHTML = "";

  const boardData =
    Array.isArray(room.board)
      ? room.board
      : Array(9).fill(null);

  const isMyTurn =
    room.status === "active" &&
    room.turn === myId;

  const banner =
    document.getElementById("turnBanner");

  if (banner) {

    if (room.status === "finished") {

      if (room.winner === "draw") {
        banner.textContent = "Draw!";
      } else if (room.winner === myId) {
        banner.textContent = "You won!";
      } else {
        banner.textContent = "Opponent won!";
      }

    } else {

      banner.textContent =
        isMyTurn
          ? "Your turn"
          : "Opponent's turn…";
    }
  }


  const meCard =
    document.getElementById("meCard");

  const opponentCard =
    document.getElementById("opponentCard");

  if (meCard) {
    meCard.classList.toggle(
      "active-turn",
      isMyTurn
    );
  }

  if (opponentCard) {
    opponentCard.classList.toggle(
      "active-turn",
      !isMyTurn &&
        room.status === "active"
    );
  }


  /*
     Create cells.

     NO onclick here.

     setupBoardClicks() handles
     every click centrally.
  */

  for (let index = 0; index < 9; index++) {

    const value =
      boardData[index] || "";

    const cell =
      document.createElement("div");

    cell.className = "cell";

    cell.dataset.index = index;

    if (value) {

      cell.classList.add("filled");
      cell.classList.add(
        value.toLowerCase()
      );

      cell.textContent = value;
    }

    if (
      room.winLine &&
      room.winLine.includes(index)
    ) {
      cell.classList.add("win");
    }

    if (
      !value &&
      room.status === "active" &&
      isMyTurn
    ) {
      cell.style.cursor = "pointer";
    }

    board.appendChild(cell);
  }
}


/* =========================================================
   BOARD CLICK FALLBACK
   ========================================================= */

function setupBoardClicks() {
  const board =
    document.getElementById(
      "board"
    );

  if (!board) {
    console.error(
      "ARENA: #board not found"
    );

    return;
  }

  if (
    board.dataset.clickReady ===
    "true"
  ) {
    return;
  }

  board.dataset.clickReady =
    "true";

  board.addEventListener(
    "click",
    (event) => {

      const cell =
        event.target.closest(
          ".cell"
        );

      if (
        !cell ||
        !board.contains(cell)
      ) {
        return;
      }

      const index =
        Number(
          cell.dataset.index
        );

      if (
        !Number.isInteger(
          index
        )
      ) {
        return;
      }

      makeMove(
        index,
        mySymbol
      );
    }
  );
}


/* =========================================================
   WINNER CHECK
   ========================================================= */

function checkWinner(board) {
  for (
    const line of WIN_LINES
  ) {
    const [a, b, c] =
      line;

    if (
      board[a] &&
      board[a] === board[b] &&
      board[a] === board[c]
    ) {
      return {
        symbol: board[a],
        line,
      };
    }
  }

  if (
    board.every(
      (cell) => cell
    )
  ) {
    return {
      symbol: "draw",
      line: null,
    };
  }

  return null;
}


/* =========================================================
   MAKE MOVE
   ========================================================= */
/* =========================================================
   MAKE MULTIPLAYER MOVE
   ========================================================= */

async function makeMove(index, symbol) {

  if (!currentRoomId || !myId) {
    return;
  }

  /*
     NEVER trust the passed symbol.
     Always use the symbol Firebase assigned
     to this client.
  */

  symbol = mySymbol;

  if (
    symbol !== "X" &&
    symbol !== "O"
  ) {
    console.error(
      "ARENA: Invalid player symbol",
      symbol
    );

    return;
  }

  if (
    index < 0 ||
    index > 8
  ) {
    return;
  }

  const roomRef =
    db.ref(
      "rooms/" +
        currentRoomId
    );

  try {

    const result =
      await roomRef.transaction(
        (room) => {

          if (!room) {
            return;
          }

          if (
            room.status !== "active"
          ) {
            return;
          }

          /*
             REAL TURN CHECK
          */

          if (
            room.turn !== myId
          ) {
            return;
          }

          if (
            !Array.isArray(room.board) ||
            room.board.length !== 9
          ) {
            return;
          }

          /*
             Cell already occupied
          */

          if (room.board[index]) {
            return;
          }

          /*
             Make sure this symbol
             belongs to this Firebase user.
          */

          const player =
            room.players?.[symbol];

          if (
            !player ||
            player.id !== myId
          ) {
            return;
          }

          /*
             PLACE MOVE
          */

          room.board[index] = symbol;

          room.moveCount =
            Number(room.moveCount || 0) + 1;

          /*
             CHECK WIN / DRAW
          */

          const result =
            checkWinner(room.board);

          if (result) {

            room.status = "finished";

            room.winLine =
              result.line;

            if (
              result.symbol === "draw"
            ) {

              room.winner = "draw";

            } else {

              room.winner =
                room.players[
                  result.symbol
                ].id;
            }

            room.finishedAt =
              firebase.database
                .ServerValue
                .TIMESTAMP;

          } else {

            /*
               Switch turn.
            */

            const nextSymbol =
              getOpponentSymbol(symbol);

            room.turn =
              room.players[
                nextSymbol
              ].id;
          }

          return room;
        }
      );


    if (!result.committed) {

      console.log(
        "Move rejected by Firebase."
      );

      return;
    }

    const updatedRoom =
      result.snapshot.val();

    if (!updatedRoom) {
      return;
    }

    /*
       Render immediately.
    */

    renderBoard(
      updatedRoom,
      mySymbol
    );


    /*
       Game finished.
    */

    if (
      updatedRoom.status === "finished"
    ) {
      await handleGameEnd(
        updatedRoom,
        mySymbol
      );
    }

  } catch (error) {

    console.error(
      "MOVE ERROR:",
      error
    );
  }
}

/* =========================================================
   REALTIME ROOM LISTENER
   ========================================================= */

function startRoomListener(
  roomId
) {
  cleanupRoomListener();

  const roomRef =
    db.ref(
      "rooms/" +
        roomId
    );

  roomListener =
    roomRef;

  roomListener.on(
    "value",
    async (snapshot) => {

      if (
        !snapshot.exists()
      ) {
        return;
      }

      const room =
        snapshot.val();


      /*
         Opponent left through
         explicit room status.
      */

      if (
        room.status ===
          "opponent-left" &&
        !resultHandled
      ) {

        showNotification(
          "Your opponent left the room."
        );

        cleanupRoomListener();
        stopOpponentPresenceListener();

        setTimeout(() => {
          currentRoomId = null;
          mySymbol = null;
          showScreen("gamemenu");
        }, 1200);

        return;
      }


      const stateKey =
        JSON.stringify({
          board: room.board,
          turn: room.turn,
          status: room.status,
          winner: room.winner,
          winLine: room.winLine,
        });

      if (
        stateKey ===
        lastRoomState
      ) {
        return;
      }

      lastRoomState =
        stateKey;


      if (
        room.players?.X &&
        room.players?.O
      ) {

        setupGameScreen(
          room,
          mySymbol
        );

        renderBoard(
          room,
          mySymbol
        );
      }


      if (
        room.status ===
          "finished" &&
        !resultHandled
      ) {
        await handleGameEnd(
          room,
          mySymbol
        );
      }
    }
  );
}


function cleanupRoomListener() {
  if (roomListener) {
    roomListener.off();
    roomListener = null;
  }
}


/* =========================================================
   OPPONENT PRESENCE / DISCONNECT
   ========================================================= */
/* =========================================================
   ROOM PRESENCE / DISCONNECT
   ========================================================= */

function stopOpponentPresenceListener() {

  if (
    opponentPresenceListener
  ) {

    opponentPresenceListener.ref.off(
      "value",
      opponentPresenceListener.callback
    );

    opponentPresenceListener = null;
  }
}


async function markRoomPresence(roomId) {

  if (
    !roomId ||
    !myId
  ) {
    return;
  }

  /*
     Each player gets their own
     connection node.
  */

  roomPresenceRef =
    db.ref(
      "roomPresence/" +
        roomId +
        "/" +
        myId
    );


  /*
     Mark ourselves online.
  */

  await roomPresenceRef.set({
    connected: true,

    name:
      myProfile?.name ||
      "Player",

    avatar:
      myProfile?.avatar ||
      "🎮",

    lastSeen:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  });


  /*
     Firebase itself changes this
     when the connection dies.

     This is what handles:
     - closing tab
     - browser crash
     - internet loss
     - laptop sleep
     - page navigation
  */

  await roomPresenceRef
    .onDisconnect()
    .remove();
}


function startOpponentPresenceListener(
  roomId,
  opponentId
) {

  stopOpponentPresenceListener();

  if (
    !roomId ||
    !opponentId
  ) {
    return;
  }

  const ref =
    db.ref(
      "roomPresence/" +
        roomId +
        "/" +
        opponentId
    );

  let wasOnline = false;

  let initialCheck = true;

  const callback =
    async (snapshot) => {

      const exists =
        snapshot.exists();

      /*
         Initial snapshot:
         don't immediately call someone
         a quitter. The other browser may
         still be connecting.
      */

      if (initialCheck) {

        initialCheck = false;

        if (exists) {
          wasOnline = true;
        }

        return;
      }


      /*
         Opponent was seen alive and
         has now disappeared.
      */

      if (
        wasOnline &&
        !exists
      ) {

        wasOnline = false;

        await handleOpponentLeft(
          roomId,
          opponentId
        );
      }


      /*
         Opponent came back.
      */

      if (exists) {
        wasOnline = true;
      }
    };


  opponentPresenceListener = {
    ref,
    callback,
  };

  ref.on(
    "value",
    callback
  );
}
/* =========================================================
   LEAVE CURRENT ROOM
   ========================================================= */

async function leaveCurrentRoom() {

  const roomId =
    currentRoomId;

  if (!roomId) {
    return;
  }

  /*
     Stop our local listener first.
  */

  stopOpponentPresenceListener();
  cleanupRoomListener();
  cleanupPrivateRoomListener();

  /*
     Remove our room presence.

     The opponent's listener will see
     this disappear and know that we left.
  */

  if (
    roomPresenceRef
  ) {

    try {
      await roomPresenceRef.remove();
    } catch (error) {
      console.error(
        "Room presence cleanup error:",
        error
      );
    }

    roomPresenceRef = null;
  }


  currentRoomId = null;
  mySymbol = null;
}
async function markRoomPresence(
  roomId
) {
  if (
    !roomId ||
    !myId
  ) {
    return;
  }

  const ref =
    db.ref(
      "roomPresence/" +
        roomId +
        "/" +
        myId
    );

  await ref.set({
    connected: true,
    name:
      myProfile?.name ||
      "Player",
    lastSeen:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  });

  await ref.onDisconnect().set({
    connected: false,
    name:
      myProfile?.name ||
      "Player",
    lastSeen:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  });
}

/* =========================================================
   OPPONENT LEFT
   ========================================================= */

async function handleOpponentLeft(
  roomId,
  opponentId
) {

  if (
    !currentRoomId ||
    currentRoomId !== roomId
  ) {
    return;
  }

  if (
    resultHandled ||
    aiGame
  ) {
    return;
  }


  /*
     Check the actual room before
     showing "opponent left".

     This prevents false notifications
     after a completed match.
  */

  try {

    const snapshot =
      await db
        .ref(
          "rooms/" +
            roomId
        )
        .once("value");

    const room =
      snapshot.val();

    if (
      !room ||
      room.status !== "active"
    ) {
      return;
    }


    const isOpponent =
      room.players?.X?.id ===
        opponentId ||
      room.players?.O?.id ===
        opponentId;

    if (!isOpponent) {
      return;
    }


    /*
       Mark room as opponent-left.
    */

    await db
      .ref(
        "rooms/" +
          roomId
      )
      .transaction(
        (current) => {

          if (!current) {
            return;
          }

          if (
            current.status !==
            "active"
          ) {
            return;
          }

          current.status =
            "opponent-left";

          current.leftPlayer =
            opponentId;

          current.leftAt =
            firebase.database
              .ServerValue
              .TIMESTAMP;

          return current;
        }
      );


    /*
       Tell this player.
    */

    showNotification(
      "Your opponent left the room."
    );


    /*
       Clean everything.
    */

    await leaveCurrentRoom();


    /*
       Send player back to game lobby.
    */

    setTimeout(() => {
      showScreen("gamemenu");
    }, 1200);

  } catch (error) {

    console.error(
      "Opponent left handling error:",
      error
    );
  }
}


/* =========================================================
   GAME END
   ========================================================= */

async function handleGameEnd(
  room,
  symbol
) {
  if (
    resultHandled
  ) {
    return;
  }

  resultHandled = true;

  cleanupRoomListener();
  stopOpponentPresenceListener();

  const iWon =
    room.winner ===
    myId;

  const draw =
    room.winner ===
    "draw";

  const opponentSymbol =
    getOpponentSymbol(
      symbol
    );

  const opponent =
    getPlayer(
      room,
      opponentSymbol
    );

  let xpChange = 0;

  if (draw) {
    xpChange = 5;
  } else if (iWon) {
    xpChange = 25;
  } else {
    xpChange = -10;
  }

  const playerRef =
    db.ref(
      "players/" +
        myId
    );

  try {

    await playerRef.transaction(
      (player) => {

        player =
          player || {
            id: myId,
            name:
              myProfile?.name ||
              "Player",
            avatar:
              myProfile?.avatar ||
              "🎮",
            xp: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            played: 0,
          };

        player.played =
          Number(
            player.played || 0
          ) + 1;

        if (draw) {

          player.draws =
            Number(
              player.draws || 0
            ) + 1;

        } else if (iWon) {

          player.wins =
            Number(
              player.wins || 0
            ) + 1;

        } else {

          player.losses =
            Number(
              player.losses || 0
            ) + 1;
        }

        player.xp =
          Math.max(
            0,
            Number(
              player.xp || 0
            ) + xpChange
          );

        return player;
      }
    );


    const profileSnapshot =
      await playerRef.once(
        "value"
      );

    if (
      profileSnapshot.exists()
    ) {
      myProfile =
        profileSnapshot.val();

      localStorage.setItem(
        "arenaProfile",
        JSON.stringify(
          myProfile
        )
      );
    }

  } catch (error) {

    console.error(
      "Game result update error:",
      error
    );
  }


  const emoji =
    document.getElementById(
      "resultEmoji"
    );

  const title =
    document.getElementById(
      "resultTitle"
    );

  const sub =
    document.getElementById(
      "resultSub"
    );

  const xp =
    document.getElementById(
      "xpChange"
    );


  if (emoji) {
    emoji.textContent =
      draw
        ? "🤝"
        : iWon
          ? "🏆"
          : "💀";
  }


  if (title) {

    title.textContent =
      draw
        ? "It's a Draw!"
        : iWon
          ? "Victory!"
          : "Defeat";

    title.className =
      "result-title " +
      (
        draw
          ? "draw"
          : iWon
            ? "win"
            : "lose"
      );
  }


  if (sub) {

    const opponentName =
      opponent?.name ||
      "your opponent";

    sub.textContent =
      draw
        ? `Evenly matched against ${opponentName}.`
        : iWon
          ? `You beat ${opponentName}. Well played!`
          : `${opponentName} got the better of you this time.`;
  }


  if (xp) {

    xp.textContent =
      (xpChange >= 0
        ? "+"
        : "") +
      xpChange +
      " XP";

    xp.className =
      "xp-change " +
      (
        xpChange >= 0
          ? "pos"
          : "neg"
      );
  }


  showScreen("result");

  await refreshLeaderboardData();
}


/* =========================================================
   AI MODE
   ========================================================= */

function startAIMatch() {

  stopSearchTimer();
  cleanupQueueListener();
  cleanupRoomListener();
  cleanupPrivateRoomListener();
  stopOpponentPresenceListener();

  aiGame = {
    active: true,

    board: Array(9).fill(null),

    mySymbol: "X",

    aiSymbol: "O",

    turn: "X",

    status: "active",

    winner: null,

    winLine: null,

    opponent: {
      id: "AI",
      name: "Arena AI",
      avatar: "🤖",
    },
  };

  currentRoomId = null;
  mySymbol = "X";

  resultHandled = false;
  lastRoomState = "";

  setupAIGameScreen();

  showScreen("game");

  renderAIBoard();

  showNotification(
    "No opponent found. Arena AI joined!"
  );
}

function setupAIGameScreen() {

  const meAvatar =
    document.getElementById(
      "meAvatar"
    );

  const meName =
    document.getElementById(
      "meName"
    );

  const meSymbol =
    document.getElementById(
      "meSymbol"
    );

  const oppAvatar =
    document.getElementById(
      "oppAvatar"
    );

  const oppName =
    document.getElementById(
      "oppName"
    );

  const oppSymbol =
    document.getElementById(
      "oppSymbol"
    );

  const meXp =
    document.getElementById(
      "meXp"
    );

  const oppXp =
    document.getElementById(
      "oppXp"
    );

  if (meAvatar) {
    meAvatar.textContent =
      myProfile?.avatar ||
      "🎮";
  }

  if (meName) {
    meName.textContent =
      (myProfile?.name ||
        "Player") +
      " (You)";
  }

  if (meSymbol) {
    meSymbol.textContent =
      "X";

    meSymbol.style.color =
      "var(--cyan)";
  }

  if (oppAvatar) {
    oppAvatar.textContent =
      "🤖";
  }

  if (oppName) {
    oppName.textContent =
      "Arena AI";
  }

  if (oppSymbol) {
    oppSymbol.textContent =
      "O";

    oppSymbol.style.color =
      "var(--pink)";
  }

  if (meXp) {
    meXp.textContent =
      `${Number(
        myProfile?.xp || 0
      )} XP`;
  }

  if (oppXp) {
    oppXp.textContent =
      "Practice";
  }
}


function renderAIBoard() {

  if (!aiGame) {
    return;
  }

  const board =
    document.getElementById(
      "board"
    );

  if (!board) {
    return;
  }

  board.innerHTML = "";

  const isMyTurn =
    aiGame.turn ===
      "X" &&
    aiGame.status ===
      "active";

  const banner =
    document.getElementById(
      "turnBanner"
    );

  if (banner) {

    if (
      aiGame.status ===
      "finished"
    ) {

      if (
        aiGame.winner ===
        "draw"
      ) {
        banner.textContent =
          "Draw!";
      } else if (
        aiGame.winner ===
        "X"
      ) {
        banner.textContent =
          "You won!";
      } else {
        banner.textContent =
          "AI won!";
      }

    } else {

      banner.textContent =
        isMyTurn
          ? "Your turn"
          : "AI is thinking…";
    }
  }


  const meCard =
    document.getElementById(
      "meCard"
    );

  const opponentCard =
    document.getElementById(
      "opponentCard"
    );

  if (meCard) {
    meCard.classList.toggle(
      "active-turn",
      isMyTurn
    );
  }

  if (opponentCard) {
    opponentCard.classList.toggle(
      "active-turn",
      !isMyTurn &&
        aiGame.status ===
          "active"
    );
  }


  for (
    let index = 0;
    index < 9;
    index++
  ) {

    const value =
      aiGame.board[index] ||
      "";

    const cell =
      document.createElement(
        "div"
      );

    cell.className =
      "cell";

    cell.dataset.index =
      index;

    if (value) {

      cell.classList.add(
        "filled"
      );

      cell.classList.add(
        value.toLowerCase()
      );

      cell.textContent =
        value;
    }


    if (
      aiGame.winLine &&
      aiGame.winLine.includes(
        index
      )
    ) {
      cell.classList.add(
        "win"
      );
    }


    if (
      !value &&
      isMyTurn
    ) {

      cell.style.cursor =
        "pointer";

      cell.onclick = () => {
        makeAIModePlayerMove(
          index
        );
      };
    }

    board.appendChild(
      cell
    );
  }
}


/* =========================================================
   PLAYER MOVE VS AI
   ========================================================= */

function makeAIModePlayerMove(
  index
) {

  if (
    !aiGame ||
    !aiGame.active
  ) {
    return;
  }

  if (
    aiGame.status !==
    "active"
  ) {
    return;
  }

  if (
    aiGame.turn !==
    "X"
  ) {
    return;
  }

  if (
    index < 0 ||
    index > 8
  ) {
    return;
  }

  if (
    aiGame.board[index]
  ) {
    return;
  }


  aiGame.board[index] =
    "X";

  aiGame.turn =
    "O";

  checkAIGameState();

  renderAIBoard();


  if (
    aiGame.status !==
    "active"
  ) {
    finishAIGame();
    return;
  }


  /*
     Small thinking delay.
  */

  aiMoveTimer = setTimeout(
  () => {
    aiMoveTimer = null;
    makeAIMove();
  },
  450
);
}


/* =========================================================
   AI MOVE
   ========================================================= */

function makeAIMove() {

  if (
    !aiGame ||
    !aiGame.active ||
    aiGame.status !==
      "active" ||
    aiGame.turn !==
      "O"
  ) {
    return;
  }

  const move =
    findBestAIMove(
      aiGame.board
    );

  if (
    move === null ||
    move === undefined
  ) {
    return;
  }

  aiGame.board[move] =
    "O";

  aiGame.turn =
    "X";

  checkAIGameState();

  renderAIBoard();


  if (
    aiGame.status !==
    "active"
  ) {
    finishAIGame();
  }
}


/* =========================================================
   SMART AI
   ========================================================= */

/* =========================================================
   SMART TIC-TAC-TOE AI
   ========================================================= */

function findBestAIMove(board) {

  let bestScore = -Infinity;
  let bestMoves = [];

  for (let i = 0; i < 9; i++) {

    if (board[i]) {
      continue;
    }

    board[i] = "O";

    const score =
      minimax(
        board,
        false,
        0
      );

    board[i] = null;

    if (score > bestScore) {

      bestScore = score;
      bestMoves = [i];

    } else if (
      score === bestScore
    ) {

      bestMoves.push(i);
    }
  }

  if (!bestMoves.length) {
    return null;
  }

  /*
     If several moves are equally good,
     randomly select one so the AI doesn't
     look completely robotic.
  */

  return bestMoves[
    Math.floor(
      Math.random() *
        bestMoves.length
    )
  ];
}


function minimax(
  board,
  maximizing,
  depth
) {

  const result =
    checkWinner(board);

  if (result) {

    if (
      result.symbol === "O"
    ) {
      return 10 - depth;
    }

    if (
      result.symbol === "X"
    ) {
      return depth - 10;
    }

    return 0;
  }


  if (maximizing) {

    let bestScore = -Infinity;

    for (let i = 0; i < 9; i++) {

      if (board[i]) {
        continue;
      }

      board[i] = "O";

      const score =
        minimax(
          board,
          false,
          depth + 1
        );

      board[i] = null;

      bestScore =
        Math.max(
          bestScore,
          score
        );
    }

    return bestScore;

  } else {

    let bestScore = Infinity;

    for (let i = 0; i < 9; i++) {

      if (board[i]) {
        continue;
      }

      board[i] = "X";

      const score =
        minimax(
          board,
          true,
          depth + 1
        );

      board[i] = null;

      bestScore =
        Math.min(
          bestScore,
          score
        );
    }

    return bestScore;
  }
}


/* =========================================================
   AI GAME STATE
   ========================================================= */

function checkAIGameState() {

  const result =
    checkWinner(
      aiGame.board
    );

  if (!result) {
    return;
  }

  aiGame.status =
    "finished";

  aiGame.winner =
    result.symbol;

  aiGame.winLine =
    result.line;
}


/* =========================================================
   FINISH AI GAME
   ========================================================= */

function finishAIGame() {

  if (
    !aiGame ||
    !aiGame.active
  ) {
    return;
  }

  aiGame.active =
    false;

  const won =
    aiGame.winner ===
    "X";

  const draw =
    aiGame.winner ===
    "draw";

  let xpChange = 0;

  /*
     AI practice rewards are
     intentionally smaller.
  */

  if (won) {
    xpChange = 10;
  } else if (draw) {
    xpChange = 3;
  } else {
    xpChange = 0;
  }


  updateAIResult(
    won,
    draw,
    xpChange
  );
}


async function updateAIResult(
  won,
  draw,
  xpChange
) {

  const emoji =
    document.getElementById(
      "resultEmoji"
    );

  const title =
    document.getElementById(
      "resultTitle"
    );

  const sub =
    document.getElementById(
      "resultSub"
    );

  const xp =
    document.getElementById(
      "xpChange"
    );


  if (emoji) {
    emoji.textContent =
      draw
        ? "🤝"
        : won
          ? "🏆"
          : "🤖";
  }


  if (title) {

    title.textContent =
      draw
        ? "It's a Draw!"
        : won
          ? "Victory!"
          : "AI Wins";

    title.className =
      "result-title " +
      (
        draw
          ? "draw"
          : won
            ? "win"
            : "lose"
      );
  }


  if (sub) {

    sub.textContent =
      draw
        ? "Evenly matched against Arena AI."
        : won
          ? "You beat the Arena AI!"
          : "Arena AI got the better of you this time.";
  }


  if (xp) {

    xp.textContent =
      (xpChange >= 0
        ? "+"
        : "") +
      xpChange +
      " XP";

    xp.className =
      "xp-change " +
      (
        xpChange >= 0
          ? "pos"
          : "neg"
      );
  }


  /*
     Update stats locally/cloud.
  */

  if (myId) {

    try {

      const playerRef =
        db.ref(
          "players/" +
            myId
        );

      await playerRef.transaction(
        (player) => {

          player =
            player || {
              id: myId,
              name:
                myProfile?.name ||
                "Player",
              avatar:
                myProfile?.avatar ||
                "🎮",
              xp: 0,
              wins: 0,
              losses: 0,
              draws: 0,
              played: 0,
            };

          player.played =
            Number(
              player.played || 0
            ) + 1;

          if (won) {

            player.wins =
              Number(
                player.wins || 0
              ) + 1;

          } else if (draw) {

            player.draws =
              Number(
                player.draws || 0
              ) + 1;
          } else {

            player.losses =
              Number(
                player.losses || 0
              ) + 1;
          }

          player.xp =
            Math.max(
              0,
              Number(
                player.xp || 0
              ) + xpChange
            );

          return player;
        }
      );

      const updated =
        await playerRef.once(
          "value"
        );

      if (
        updated.exists()
      ) {

        myProfile =
          updated.val();

        localStorage.setItem(
          "arenaProfile",
          JSON.stringify(
            myProfile
          )
        );
      }

    } catch (error) {

      console.error(
        "AI result update error:",
        error
      );
    }
  }


  showScreen(
    "result"
  );

  await refreshLeaderboardData();

  aiGame = null;
}


/* =========================================================
   STOP AI
   ========================================================= */

/* =========================================================
   STOP AI
   ========================================================= */

function stopAI() {

  if (aiMoveTimer) {
    clearTimeout(aiMoveTimer);
    aiMoveTimer = null;
  }

  aiGame = null;
}

/* =========================================================
   SETUP SCREEN
   ========================================================= */

function showSetup() {
  const overlay =
    document.getElementById(
      "setupOverlay"
    );

  if (overlay) {
    overlay.style.display =
      "flex";
  }

  renderAvatarPicker();
}


/* =========================================================
   BOOT
   ========================================================= */

async function boot() {

  try {

    /*
       Anonymous Firebase login.
    */

    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }

    myId =
      auth.currentUser.uid;

    console.log(
      "Firebase user:",
      myId
    );


    /*
       IMPORTANT:
       Enable board click system.
    */

    setupBoardClicks();


    /*
       Load cloud profile.
    */

    const cloudSnapshot =
      await db
        .ref(
          "players/" +
            myId
        )
        .once("value");

    if (
      cloudSnapshot.exists()
    ) {

      myProfile =
        cloudSnapshot.val();

      localStorage.setItem(
        "arenaProfile",
        JSON.stringify(
          myProfile
        )
      );

      applyProfileToNav();

    } else {

      /*
         Fallback to local profile.
      */

      const local =
        localStorage.getItem(
          "arenaProfile"
        );

      if (local) {

        try {

          const parsed =
            JSON.parse(local);

          myProfile = {
            ...parsed,
            id: myId,
          };

          await db
            .ref(
              "players/" +
                myId
            )
            .set(myProfile);

          applyProfileToNav();

        } catch (error) {

          console.error(
            "Local profile error:",
            error
          );

          showSetup();
        }

      } else {

        showSetup();
      }
    }


    /*
       Presence.
    */

    startPresence();


    /*
       Leaderboard.
    */

    await refreshLeaderboardData();


    /*
       Periodic leaderboard.
    */

    setInterval(
      refreshLeaderboardData,
      10000
    );

  } catch (error) {

    console.error(
      "BOOT ERROR:",
      error
    );

    alert(
      "Firebase connection failed.\n\n" +
        error.message
    );
  }
}

/* =========================================================
   PAGE CLOSE CLEANUP
   ========================================================= */

window.addEventListener(
  "beforeunload",
  () => {

    /*
       Firebase onDisconnect()
       handles the room presence.

       We only clean local listeners here.
    */

    if (presenceRef) {
      presenceRef.remove();
    }

    cleanupQueueListener();
    cleanupRoomListener();
    cleanupPrivateRoomListener();
    stopOpponentPresenceListener();

    if (aiMoveTimer) {
      clearTimeout(aiMoveTimer);
      aiMoveTimer = null;
    }
  }
);


/* =========================================================
   START APPLICATION
   ========================================================= */

boot();

