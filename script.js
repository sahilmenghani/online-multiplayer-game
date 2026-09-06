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

/*
   Latest known state of the multiplayer room,
   kept in sync by startRoomListener().
   setupBoardClicks() reads this instead of
   a non-existent global.
*/
let currentRoomData = null;

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

    board: Array(9).fill(""),

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

    board: Array(9).fill(""),

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
  symbol,
  retryCount = 0
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
      if (retryCount >= 12) {
        // ~5 seconds of retrying; give up for real.
        alert(
          "Waiting for the second player."
        );
        showScreen("gamemenu");
        return;
      }

      setTimeout(() => {
        enterRoom(roomId, symbol, retryCount + 1);
      }, 400);

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
      ? Array.from({ length: 9 }, (_, i) => room.board[i] || "")
      : Array(9).fill("");

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
  const board = document.getElementById("board");

  if (!board) return;

  board.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");

    if (!cell) return;

    const index = Number(cell.dataset.index);

    // AI GAME (handled here only if aiGame is active;
    // renderAIBoard() also attaches its own onclick,
    // but this keeps behavior consistent either way)
    if (aiGame) {
      makeAIModePlayerMove(index);
      return;
    }

    // HUMAN MULTIPLAYER
    if (!currentRoomId || !currentRoomData) return;

    if (currentRoomData.status !== "active") return;

    if (currentRoomData.turn !== myId) return;

    if (currentRoomData.board?.[index]) return;

    makeMove(index);
  });
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
let moveInFlight = false;

async function makeMove(index) {
  if (!currentRoomId || !myId) return;

  // Prevent a second click from starting a
  // second transaction before the first one
  // (and its Firebase retries) has settled.
  if (moveInFlight) return;
  moveInFlight = true;

  const roomRef = db.ref("rooms/" + currentRoomId);

  try {
    const result = await roomRef.transaction((room) => {
      if (!room) return;

      // Game must be active
      if (room.status !== "active") return;

      // -------------------------------------------------
      // IMPORTANT:
      // players are stored as players.X and players.O
      // NOT players[myId]
      // -------------------------------------------------

      let mySymbol = null;
      let opponentSymbol = null;

      if (room.players?.X?.id === myId) {
        mySymbol = "X";
        opponentSymbol = "O";
      } else if (room.players?.O?.id === myId) {
        mySymbol = "O";
        opponentSymbol = "X";
      } else {
        // I am not a player in this room
        return;
      }

      // It must be my turn
      if (room.turn !== myId) {
        return;
      }

      // Make sure board exists AND has exactly 9 slots.
      // Firebase can hand back a shorter array (or an
      // object) if slots were ever stored as null, so
      // normalize defensively every time, never trusting
      // the raw length/type coming back from the DB.
      if (!Array.isArray(room.board)) {
        room.board = Array(9).fill("");
      } else if (room.board.length < 9) {
        const padded = Array(9).fill("");
        for (let i = 0; i < room.board.length; i++) {
          padded[i] = room.board[i] || "";
        }
        room.board = padded;
      }

      // Invalid cell
      if (index < 0 || index > 8) {
        return;
      }

      // Cell already occupied
      if (room.board[index]) {
        return;
      }

      // -------------------------------------------------
      // PLACE MOVE
      // -------------------------------------------------

      const newBoard = room.board.slice();
      newBoard[index] = mySymbol;
      room.board = newBoard;

      room.moveCount =
        Number(room.moveCount || 0) + 1;

      // -------------------------------------------------
      // CHECK WIN — always evaluated on the freshly
      // placed board, never a stale reference, and
      // draw is only possible if there is NO winner.
      // -------------------------------------------------

      const result = checkWinner(room.board);

      if (result && result.symbol !== "draw") {
        room.status = "finished";
        room.winner = myId;
        room.winLine = result.line;

        return room;
      }

      if (result && result.symbol === "draw") {
        // checkWinner only reports "draw" when
        // every one of the 9 cells is truthy AND
        // no 3-in-a-row exists, so this is safe.
        room.status = "finished";
        room.winner = "draw";
        room.winLine = null;

        return room;
      }

      // -------------------------------------------------
      // CHANGE TURN TO OPPONENT
      // -------------------------------------------------

      const opponent = room.players?.[opponentSymbol];

      if (!opponent?.id) {
        return;
      }

      room.turn = opponent.id;

      return room;
    });

    if (!result.committed) {
      console.log(
        "Move rejected. Current room:",
        result.snapshot.val()
      );

      return;
    }

    console.log("MOVE SUCCESS:", index);

  } catch (error) {
    console.error("MAKE MOVE ERROR:", error);
  } finally {
    moveInFlight = false;
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

      try {

        if (
          !snapshot.exists()
        ) {
          return;
        }

        const room =
          snapshot.val();

        currentRoomData = room;

        console.log(
          "ROOM UPDATE:",
          room.status,
          "winner:",
          room.winner,
          "turn:",
          room.turn
        );


        /*
           Opponent left through
           explicit room status.
        */

        if (
          room.status ===
            "opponent-left" &&
          !resultHandled
        ) {

          resultHandled = true;

          showNotification(
            "Your opponent left the room."
          );

          cleanupRoomListener();
          stopOpponentPresenceListener();

          setTimeout(() => {
            currentRoomId = null;
            mySymbol = null;
            showScreen("home");
          }, 1200);

          return;
        }


        /*
           IMPORTANT:
           Check for game end FIRST, and run it
           independently of the rendering step below.
           If setupGameScreen/renderBoard ever throws
           for any reason, that must NOT be able to
           silently swallow the win/draw notification —
           that was the suspected cause of the result
           only ever showing on the mover's own device.
        */

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


        if (
          room.players?.X &&
          room.players?.O
        ) {

          try {

            setupGameScreen(
              room,
              mySymbol
            );

            renderBoard(
              room,
              mySymbol
            );

          } catch (renderError) {
            console.error(
              "ROOM RENDER ERROR:",
              renderError
            );
          }
        }

      } catch (error) {
        console.error(
          "ROOM LISTENER ERROR:",
          error
        );
      }
    },
    (error) => {
      // Fires on permission-denied or the
      // listener being cancelled by the server.
      // If this ever logs, the DB rules are the
      // real blocker — not app logic.
      console.error(
        "ROOM LISTENER CANCELLED:",
        error
      );
    }
  );
}


function cleanupRoomListener() {
  if (roomListener) {
    roomListener.off();
    roomListener = null;
  }

  currentRoomData = null;
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

    resultHandled = true;

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
       Send player back to home.
    */

    setTimeout(() => {
      showScreen("home");
    }, 1200);

  } catch (error) {

    console.error(
      "Opponent left handling error:",
      error
    );
  }
}

/* =========================================================
   GAME END — MULTIPLAYER RESULT
   Both players are notified from the Firebase room result.
   ========================================================= */

async function handleGameEnd(room, symbol) {
  if (!room || room.status !== "finished") {
    return;
  }

  // Prevent the same client from processing the same result twice
  if (resultHandled) {
    return;
  }

  resultHandled = true;

  const iWon = room.winner === myId;
  const draw = room.winner === "draw";

  const opponentSymbol = getOpponentSymbol(symbol);

  const opponent = getPlayer(
    room,
    opponentSymbol
  );

  /*
     ========================================================
     IMPORTANT

     The result is calculated independently on EACH device.

     Player A:
       room.winner === A's ID  -> Victory

     Player B:
       room.winner === A's ID  -> Defeat

     Draw:
       room.winner === "draw"  -> Draw

     Therefore both browsers receive the exact same Firebase
     room state but display their own correct result.
     ========================================================
  */

  let titleText;
  let subText;
  let emoji;
  let resultClass;
  let xpChange;

  if (draw) {
    emoji = "🤝";
    titleText = "It's a Draw!";
    resultClass = "draw";
    xpChange = 5;

    subText =
      `Evenly matched against ${
        opponent?.name || "your opponent"
      }.`;
  } else if (iWon) {
    emoji = "🏆";
    titleText = "Victory!";
    resultClass = "win";
    xpChange = 25;

    subText =
      `You beat ${
        opponent?.name || "your opponent"
      }. Well played!`;
  } else {
    emoji = "💀";
    titleText = "Defeat";
    resultClass = "lose";
    xpChange = -10;

    subText =
      `${
        opponent?.name || "Your opponent"
      } got the better of you this time.`;
  }

  /*
     ========================================================
     SHOW RESULT IMMEDIATELY

     Do this BEFORE updating XP/database so the opponent
     doesn't have to wait for Firebase transactions.
     ========================================================
  */

  const emojiElement =
    document.getElementById("resultEmoji");

  const titleElement =
    document.getElementById("resultTitle");

  const subElement =
    document.getElementById("resultSub");

  const xpElement =
    document.getElementById("xpChange");

  if (emojiElement) {
    emojiElement.textContent = emoji;
  }

  if (titleElement) {
    titleElement.textContent = titleText;

    titleElement.className =
      "result-title " + resultClass;
  }

  if (subElement) {
    subElement.textContent = subText;
  }

  if (xpElement) {
    xpElement.textContent =
      (xpChange >= 0 ? "+" : "") +
      xpChange +
      " XP";

    xpElement.className =
      "xp-change " +
      (xpChange >= 0 ? "pos" : "neg");
  }

  /*
     Immediate toast notification too.
     So the player who DID NOT make the final move
     also gets a clear notification.
  */

  if (draw) {
    showNotification("🤝 The game ended in a draw!");
  } else if (iWon) {
    showNotification("🏆 You won the game!");
  } else {
    showNotification(
      `💀 ${opponent?.name || "Your opponent"} won the game.`
    );
  }

  /*
     Open result screen immediately.
  */

  showScreen("result");

  /*
     ========================================================
     UPDATE PLAYER STATS
     ========================================================
  */

  if (myId) {
    try {
      const playerRef =
        db.ref("players/" + myId);

      await playerRef.transaction((player) => {
        player =
          player || {
            id: myId,
            name:
              myProfile?.name || "Player",
            avatar:
              myProfile?.avatar || "🎮",
            xp: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            played: 0,
          };

        player.played =
          Number(player.played || 0) + 1;

        if (draw) {
          player.draws =
            Number(player.draws || 0) + 1;
        } else if (iWon) {
          player.wins =
            Number(player.wins || 0) + 1;
        } else {
          player.losses =
            Number(player.losses || 0) + 1;
        }

        player.xp = Math.max(
          0,
          Number(player.xp || 0) + xpChange
        );

        return player;
      });

      /*
         Refresh local profile after stats update.
      */

      const profileSnapshot =
        await playerRef.once("value");

      if (profileSnapshot.exists()) {
        myProfile =
          profileSnapshot.val();

        localStorage.setItem(
          "arenaProfile",
          JSON.stringify(myProfile)
        );
      }

    } catch (error) {
      console.error(
        "Game result update error:",
        error
      );
    }
  }

  /*
     Refresh leaderboard after stats update.
  */

  await refreshLeaderboardData();

  /*
     Only NOW stop listening to the finished room.
  */

  cleanupRoomListener();
  stopOpponentPresenceListener();
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

    board: Array(9).fill(""),

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

    if (roomPresenceRef) {
      // Best-effort synchronous cleanup; the
      // server-side onDisconnect() handler set up
      // in markRoomPresence() is the real guarantee,
      // but firing this too means a normal refresh/
      // close is detected as fast as possible.
      roomPresenceRef.remove();
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
/* =========================================================
   ARENA — CONNECT FOUR
   Firebase Multiplayer
   Completely separate from Tic-Tac-Toe logic
   ========================================================= */


/* =========================================================
   CONNECT FOUR STATE
   ========================================================= */

let cfRoomId = null;
let cfMyColor = null;

let cfRoomListener = null;
let cfQueueListener = null;
let cfPrivateListener = null;

let cfMoveInFlight = false;
let cfResultHandled = false;

const CF_ROWS = 6;
const CF_COLS = 7;
const CF_TOTAL = 42;


/* =========================================================
   OPEN CONNECT FOUR
   ========================================================= */

function openConnectFour() {

  /*
     Clean only Connect Four state.
     We do NOT touch Tic-Tac-Toe state.
  */

  cfCleanupAllListeners();

  cfRoomId = null;
  cfMyColor = null;

  cfResultHandled = false;
  cfMoveInFlight = false;

  showScreen("cf-menu");
}


/* =========================================================
   CLOSE CONNECT FOUR
   ========================================================= */

function closeConnectFour() {

  cfCleanupAllListeners();

  cfRoomId = null;
  cfMyColor = null;

  cfResultHandled = false;
  cfMoveInFlight = false;

  showScreen("home");
}


/* =========================================================
   CLEANUP
   ========================================================= */

function cfCleanupRoomListener() {

  if (cfRoomListener) {

    cfRoomListener.off();

    cfRoomListener = null;
  }
}


function cfCleanupQueueListener() {

  if (cfQueueListener) {

    cfQueueListener.off();

    cfQueueListener = null;
  }
}


function cfCleanupPrivateListener() {

  if (
    cfPrivateListener &&
    cfRoomId
  ) {

    db
      .ref("rooms/" + cfRoomId)
      .off(
        "value",
        cfPrivateListener
      );
  }

  cfPrivateListener = null;
}


function cfCleanupAllListeners() {

  cfCleanupRoomListener();
  cfCleanupQueueListener();
  cfCleanupPrivateListener();
}


/* =========================================================
   RANDOM ROOM CODE
   ========================================================= */

function cfGenerateCode() {

  return Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();
}


/* =========================================================
   CREATE PRIVATE ROOM
   ========================================================= */

async function createConnectFourRoom() {

  if (!myId || !myProfile) {

    alert(
      "Please finish your profile first."
    );

    return;
  }


  cfCleanupAllListeners();

  let code = null;
  let roomId = null;


  for (
    let attempt = 0;
    attempt < 10;
    attempt++
  ) {

    const candidate =
      cfGenerateCode();

    const candidateId =
      "cf_priv_" + candidate;

    const snapshot =
      await db
        .ref("rooms/" + candidateId)
        .once("value");


    if (!snapshot.exists()) {

      code = candidate;
      roomId = candidateId;

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

    game: "connectfour",

    code,

    players: {

      R: {

        id: myId,

        name:
          myProfile.name,

        avatar:
          myProfile.avatar,

      },

      Y: null,
    },


    board:
      Array(CF_TOTAL).fill(""),


    turn:
      myId,


    status:
      "waiting",


    winner:
      null,


    winLine:
      null,


    moveCount:
      0,


    createdAt:
      firebase.database
        .ServerValue
        .TIMESTAMP,
  };


  try {

    await db
      .ref("rooms/" + roomId)
      .set(room);


    cfRoomId = roomId;
    cfMyColor = "R";

    cfResultHandled = false;


    const codeElement =
      document.getElementById(
        "cfPrivateRoomCode"
      );


    if (codeElement) {

      codeElement.textContent =
        code;
    }


    showScreen(
      "cf-privatewait"
    );


    const roomRef =
      db.ref(
        "rooms/" + roomId
      );


    cfPrivateListener =
      async (snapshot) => {

        if (!snapshot.exists()) {
          return;
        }


        const updated =
          snapshot.val();


        if (
          updated.game ===
            "connectfour" &&

          updated.status ===
            "active" &&

          updated.players?.Y
        ) {

          roomRef.off(
            "value",
            cfPrivateListener
          );

          cfPrivateListener = null;


          await cfEnterRoom(
            roomId,
            "R"
          );
        }
      };


    roomRef.on(
      "value",
      cfPrivateListener
    );


  } catch (error) {

    console.error(
      "Connect Four private room error:",
      error
    );

    alert(
      "Could not create room: " +
      error.message
    );
  }
}


/* =========================================================
   JOIN PRIVATE ROOM
   ========================================================= */

async function joinConnectFourRoom() {

  if (!myId || !myProfile) {

    alert(
      "Please finish your profile first."
    );

    return;
  }


  const input =
    document.getElementById(
      "cfJoinCodeInput"
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
    "cf_priv_" + code;


  const roomRef =
    db.ref(
      "rooms/" + roomId
    );


  try {

    const result =
      await roomRef.transaction(
        (room) => {

          if (!room) {
            return;
          }


          if (
            room.game !==
            "connectfour"
          ) {
            return;
          }


          if (
            room.status !==
            "waiting"
          ) {
            return;
          }


          if (
            room.players?.R?.id ===
            myId
          ) {
            return;
          }


          if (
            room.players?.Y
          ) {
            return;
          }


          room.players.Y = {

            id:
              myId,

            name:
              myProfile.name,

            avatar:
              myProfile.avatar,
          };


          room.status =
            "active";


          return room;
        }
      );


    if (!result.committed) {

      const check =
        await roomRef.once(
          "value"
        );


      if (!check.exists()) {

        alert(
          "Room not found. Check the code."
        );

      } else {

        alert(
          "This room is no longer available."
        );
      }

      return;
    }


    cfRoomId = roomId;
    cfMyColor = "Y";

    cfResultHandled = false;


    await cfEnterRoom(
      roomId,
      "Y"
    );


  } catch (error) {

    console.error(
      "Connect Four join error:",
      error
    );

    alert(
      "Could not join room: " +
      error.message
    );
  }
}


/* =========================================================
   QUICK MATCH
   ========================================================= */

async function startConnectFourQuickMatch() {

  if (!myId || !myProfile) {

    alert(
      "Please finish your profile first."
    );

    return;
  }


  cfCleanupAllListeners();

  cfRoomId = null;
  cfMyColor = null;

  cfResultHandled = false;


  showScreen(
    "cf-searching"
  );


  const searchSub =
    document.getElementById(
      "cfSearchSub"
    );


  if (searchSub) {

    searchSub.textContent =
      "Looking for an opponent…";
  }


  const queueRef =
    db.ref(
      "queues/connectfour"
    );


  const generatedRoomId =
    "cf_r_" +
    Math.random()
      .toString(36)
      .slice(2, 10);


  try {

    const result =
      await queueRef.transaction(
        (current) => {


          /*
             Nobody is waiting.
             Become the waiting player.
          */

          if (!current) {

            return {

              status:
                "waiting",

              player: {

                id:
                  myId,

                name:
                  myProfile.name,

                avatar:
                  myProfile.avatar,
              },


              ts:
                firebase.database
                  .ServerValue
                  .TIMESTAMP,
            };
          }


          /*
             Someone is already waiting.
          */

          if (
            current.status ===
              "waiting" &&

            current.player &&

            current.player.id !==
              myId
          ) {

            return {

              status:
                "matched",

              roomId:
                generatedRoomId,

              creatorId:
                myId,

              creator: {

                id:
                  myId,

                name:
                  myProfile.name,

                avatar:
                  myProfile.avatar,
              },


              opponent:
                current.player,


              ts:
                firebase.database
                  .ServerValue
                  .TIMESTAMP,
            };
          }


          return current;
        }
      );


    if (!result.committed) {

      await cfWaitForMatch();

      return;
    }


    const state =
      result.snapshot.val();


    if (
      state?.status ===
        "matched" &&

      state.creatorId ===
        myId &&

      state.opponent
    ) {

      await cfCreateMatchedRoom(
        state
      );

      return;
    }


    await cfWaitForMatch();


  } catch (error) {

    console.error(
      "Connect Four matchmaking error:",
      error
    );


    if (searchSub) {

      searchSub.textContent =
        "Unable to connect. Try again.";
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

async function cfWaitForMatch() {

  cfCleanupQueueListener();


  const queueRef =
    db.ref(
      "queues/connectfour"
    );


  const callback =
    async (snapshot) => {

      const state =
        snapshot.val();


      if (!state) {
        return;
      }


      if (
        state.status ===
          "matched" &&

        state.opponent?.id ===
          myId
      ) {

        cfCleanupQueueListener();


        await cfCreateMatchedRoom(
          state
        );
      }
    };


  cfQueueListener =
    queueRef;


  queueRef.on(
    "value",
    callback
  );
}


/* =========================================================
   CREATE MATCHED ROOM
   ========================================================= */

async function cfCreateMatchedRoom(
  state
) {

  const roomId =
    state.roomId;


  const creator =
    state.creator;


  const opponent =
    state.opponent;


  const room = {

    id:
      roomId,

    game:
      "connectfour",


    players: {

      R: {

        id:
          creator.id,

        name:
          creator.name,

        avatar:
          creator.avatar,
      },


      Y: {

        id:
          opponent.id,

        name:
          opponent.name,

        avatar:
          opponent.avatar,
      },
    },


    board:
      Array(CF_TOTAL).fill(""),


    turn:
      creator.id,


    status:
      "active",


    winner:
      null,


    winLine:
      null,


    moveCount:
      0,


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
       Remove queue only if it is
       still this match.
    */

    await db
      .ref("queues/connectfour")
      .transaction(
        (current) => {

          if (
            current?.status ===
              "matched" &&

            current.roomId ===
              roomId
          ) {

            return null;
          }


          return current;
        }
      );


    /*
       Creator is RED.
    */

    if (
      creator.id ===
      myId
    ) {

      await cfEnterRoom(
        roomId,
        "R"
      );

    } else {

      /*
         Opponent is YELLOW.
      */

      await cfEnterRoom(
        roomId,
        "Y"
      );
    }


  } catch (error) {

    console.error(
      "Create Connect Four room error:",
      error
    );
  }
}


/* =========================================================
   ENTER ROOM
   ========================================================= */

async function cfEnterRoom(
  roomId,
  color,
  retryCount = 0
) {

  if (
    !roomId ||
    !myId
  ) {
    return;
  }


  cfRoomId =
    roomId;

  cfMyColor =
    color;


  cfResultHandled =
    false;


  try {

    const snapshot =
      await db
        .ref(
          "rooms/" +
          roomId
        )
        .once("value");


    if (!snapshot.exists()) {

      if (
        retryCount <
        15
      ) {

        setTimeout(
          () => {

            cfEnterRoom(
              roomId,
              color,
              retryCount + 1
            );

          },
          400
        );

        return;
      }


      alert(
        "Match could not be loaded."
      );

      showScreen(
        "cf-menu"
      );

      return;
    }


    const room =
      snapshot.val();


    if (
      room.game !==
      "connectfour"
    ) {

      alert(
        "This is not a Connect Four room."
      );

      return;
    }


    const me =
      room.players?.[
        color
      ];


    const opponentColor =
      color === "R"
        ? "Y"
        : "R";


    const opponent =
      room.players?.[
        opponentColor
      ];


    if (
      !me ||
      !opponent
    ) {

      if (
        retryCount <
        15
      ) {

        setTimeout(
          () => {

            cfEnterRoom(
              roomId,
              color,
              retryCount + 1
            );

          },
          400
        );

        return;
      }


      alert(
        "Waiting for the second player."
      );

      showScreen(
        "cf-menu"
      );

      return;
    }


    cfSetupGameScreen(
      room,
      color
    );


    showScreen(
      "connectfour"
    );


    cfStartRoomListener(
      roomId
    );


    showNotification(
      "🎮 Connect Four match started!"
    );


  } catch (error) {

    console.error(
      "Connect Four enter error:",
      error
    );
  }
}


/* =========================================================
   GAME SCREEN SETUP
   ========================================================= */

function cfSetupGameScreen(
  room,
  color
) {

  const opponentColor =
    color === "R"
      ? "Y"
      : "R";


  const me =
    room.players?.[
      color
    ];


  const opponent =
    room.players?.[
      opponentColor
    ];


  if (!me || !opponent) {
    return;
  }


  const meAvatar =
    document.getElementById(
      "cfMeAvatar"
    );


  const meName =
    document.getElementById(
      "cfMeName"
    );


  const oppAvatar =
    document.getElementById(
      "cfOppAvatar"
    );


  const oppName =
    document.getElementById(
      "cfOppName"
    );


  const mePiece =
    document.getElementById(
      "cfMePiece"
    );


  const oppPiece =
    document.getElementById(
      "cfOppPiece"
    );


  if (meAvatar) {

    meAvatar.textContent =
      me.avatar ||
      "🎮";
  }


  if (meName) {

    meName.textContent =
      (me.name ||
        "Player") +
      " (You)";
  }


  if (oppAvatar) {

    oppAvatar.textContent =
      opponent.avatar ||
      "🎮";
  }


  if (oppName) {

    oppName.textContent =
      opponent.name ||
      "Opponent";
  }


  if (mePiece) {

    mePiece.className =
      "cf-piece " +
      (
        color === "R"
          ? "red"
          : "yellow"
      );
  }


  if (oppPiece) {

    oppPiece.className =
      "cf-piece " +
      (
        opponentColor === "R"
          ? "red"
          : "yellow"
      );
  }


  /*
     Load XP.
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

  ]).then(
    ([meSnapshot, oppSnapshot]) => {

      const meData =
        meSnapshot.val();

      const oppData =
        oppSnapshot.val();


      const meXp =
        document.getElementById(
          "cfMeXp"
        );


      const oppXp =
        document.getElementById(
          "cfOppXp"
        );


      if (meXp) {

        meXp.textContent =
          Number(
            meData?.xp || 0
          ) +
          " XP";
      }


      if (oppXp) {

        oppXp.textContent =
          Number(
            oppData?.xp || 0
          ) +
          " XP";
      }
    }
  );


  cfRenderBoard(
    room,
    color
  );
}


/* =========================================================
   REALTIME ROOM LISTENER
   ========================================================= */

function cfStartRoomListener(
  roomId
) {

  cfCleanupRoomListener();


  const roomRef =
    db.ref(
      "rooms/" +
      roomId
    );


  cfRoomListener =
    roomRef;


  roomRef.on(
    "value",
    async (snapshot) => {

      try {

        if (!snapshot.exists()) {
          return;
        }


        const room =
          snapshot.val();


        /*
           Only process Connect Four rooms.
        */

        if (
          room.game !==
          "connectfour"
        ) {
          return;
        }


        /*
           GAME FINISHED
        */

        if (
          room.status ===
            "finished" &&

          !cfResultHandled
        ) {

          await cfHandleGameEnd(
            room
          );

          return;
        }


        /*
           Normal game update.
        */

        cfSetupGameScreen(
          room,
          cfMyColor
        );


      } catch (error) {

        console.error(
          "Connect Four listener error:",
          error
        );
      }
    }
  );
}


/* =========================================================
   RENDER BOARD
   ========================================================= */

function cfRenderBoard(
  room,
  color
) {

  const board =
    document.getElementById(
      "cfBoard"
    );


  if (!board) {
    return;
  }


  board.innerHTML = "";


  const boardData =
    Array.isArray(room.board)
      ? Array.from(
          {
            length:
              CF_TOTAL
          },
          (_, index) =>
            room.board[index] ||
            ""
        )
      : Array(
          CF_TOTAL
        ).fill("");


  const isMyTurn =
    room.status ===
      "active" &&

    room.turn ===
      myId;


  const banner =
    document.getElementById(
      "cfTurnBanner"
    );


  if (banner) {

    if (
      room.status ===
      "finished"
    ) {

      if (
        room.winner ===
        "draw"
      ) {

        banner.textContent =
          "Draw!";

      } else if (
        room.winner ===
        myId
      ) {

        banner.textContent =
          "You won!";

      } else {

        banner.textContent =
          "Opponent won!";
      }

    } else {

      banner.textContent =
        isMyTurn
          ? "Your turn"
          : "Opponent's turn…";
    }
  }


  const meCard =
    document.getElementById(
      "cfMeCard"
    );


  const opponentCard =
    document.getElementById(
      "cfOpponentCard"
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
      room.status ===
        "active"
    );
  }


  for (
    let index = 0;
    index < CF_TOTAL;
    index++
  ) {

    const value =
      boardData[index];


    const cell =
      document.createElement(
        "div"
      );


    cell.className =
      "cf-cell";


    cell.dataset.index =
      index;


    if (value) {

      cell.classList.add(
        "filled"
      );


      cell.classList.add(
        value === "R"
          ? "red"
          : "yellow"
      );
    }


    if (
      room.winLine &&
      room.winLine.includes(
        index
      )
    ) {

      cell.classList.add(
        "win"
      );
    }


    if (
      !value &&
      room.status ===
        "active" &&
      isMyTurn
    ) {

      cell.style.cursor =
        "pointer";


      cell.onclick = () => {

        const column =
          index %
          CF_COLS;


        cfMakeMove(
          column
        );
      };
    }


    board.appendChild(
      cell
    );
  }
}


/* =========================================================
   MAKE MOVE
   ========================================================= */

async function cfMakeMove(
  column
) {

  if (
    !cfRoomId ||
    !myId ||
    !cfMyColor
  ) {
    return;
  }


  if (cfMoveInFlight) {
    return;
  }


  cfMoveInFlight =
    true;


  const roomRef =
    db.ref(
      "rooms/" +
      cfRoomId
    );


  try {

    const result =
      await roomRef.transaction(
        (room) => {

          if (!room) {
            return;
          }


          if (
            room.game !==
            "connectfour"
          ) {
            return;
          }


          if (
            room.status !==
            "active"
          ) {
            return;
          }


          if (
            room.turn !==
            myId
          ) {
            return;
          }


          if (
            column < 0 ||
            column >= CF_COLS
          ) {
            return;
          }


          /*
             Normalize board.
          */

          if (
            !Array.isArray(
              room.board
            )
          ) {

            room.board =
              Array(
                CF_TOTAL
              ).fill("");

          } else if (
            room.board.length <
            CF_TOTAL
          ) {

            const padded =
              Array(
                CF_TOTAL
              ).fill("");

            for (
              let i = 0;
              i <
              room.board.length;
              i++
            ) {

              padded[i] =
                room.board[i] ||
                "";
            }

            room.board =
              padded;
          }


          /*
             Find lowest empty row.
          */

          let targetIndex =
            -1;


          for (
            let row =
              CF_ROWS - 1;
            row >= 0;
            row--
          ) {

            const index =
              row *
                CF_COLS +
              column;


            if (
              !room.board[index]
            ) {

              targetIndex =
                index;

              break;
            }
          }


          /*
             Column is full.
          */

          if (
            targetIndex ===
            -1
          ) {

            return;
          }


          /*
             Drop piece.
          */

          room.board[
            targetIndex
          ] =
            cfMyColor;


          room.moveCount =
            Number(
              room.moveCount ||
              0
            ) + 1;


          /*
             Check winner.
          */

          const win =
            cfCheckWinner(
              room.board
            );


          if (win) {

            room.status =
              "finished";


            room.winner =
              myId;


            room.winLine =
              win;


            return room;
          }


          /*
             Check draw.
          */

          const draw =
            room.board.every(
              (cell) =>
                !!cell
            );


          if (draw) {

            room.status =
              "finished";


            room.winner =
              "draw";


            room.winLine =
              null;


            return room;
          }


          /*
             Find opponent.
          */

          const opponentColor =
            cfMyColor ===
            "R"
              ? "Y"
              : "R";


          const opponent =
            room.players?.[
              opponentColor
            ];


          if (!opponent?.id) {
            return;
          }


          room.turn =
            opponent.id;


          return room;
        }
      );


    if (
      !result.committed
    ) {

      return;
    }


  } catch (error) {

    console.error(
      "Connect Four move error:",
      error
    );

  } finally {

    cfMoveInFlight =
      false;
  }
}


/* =========================================================
   CHECK CONNECT FOUR WIN
   ========================================================= */

function cfCheckWinner(
  board
) {

  const directions = [

    [0, 1],

    [1, 0],

    [1, 1],

    [1, -1],

  ];


  for (
    let row = 0;
    row < CF_ROWS;
    row++
  ) {

    for (
      let col = 0;
      col < CF_COLS;
      col++
    ) {

      const index =
        row *
          CF_COLS +
        col;


      const player =
        board[index];


      if (!player) {
        continue;
      }


      for (
        const [
          dr,
          dc
        ] of directions
      ) {

        const line = [
          index
        ];


        for (
          let step = 1;
          step < 4;
          step++
        ) {

          const nextRow =
            row +
            dr *
              step;


          const nextCol =
            col +
            dc *
              step;


          if (
            nextRow < 0 ||
            nextRow >=
              CF_ROWS ||
            nextCol < 0 ||
            nextCol >=
              CF_COLS
          ) {

            break;
          }


          const nextIndex =
            nextRow *
              CF_COLS +
            nextCol;


          if (
            board[
              nextIndex
            ] !==
            player
          ) {

            break;
          }


          line.push(
            nextIndex
          );
        }


        if (
          line.length ===
          4
        ) {

          return line;
        }
      }
    }
  }


  return null;
}


/* =========================================================
   GAME END
   ========================================================= */

async function cfHandleGameEnd(
  room
) {

  if (
    !room ||
    room.status !==
      "finished"
  ) {
    return;
  }


  if (
    cfResultHandled
  ) {
    return;
  }


  cfResultHandled =
    true;


  const draw =
    room.winner ===
    "draw";


  const iWon =
    room.winner ===
    myId;


  const opponentColor =
    cfMyColor ===
    "R"
      ? "Y"
      : "R";


  const opponent =
    room.players?.[
      opponentColor
    ];


  let emoji;
  let title;
  let sub;
  let xpChange;
  let resultClass;


  if (draw) {

    emoji =
      "🤝";

    title =
      "It's a Draw!";

    resultClass =
      "draw";

    xpChange =
      5;

    sub =
      `Evenly matched against ${
        opponent?.name ||
        "your opponent"
      }.`;


  } else if (iWon) {

    emoji =
      "🏆";

    title =
      "Victory!";

    resultClass =
      "win";

    xpChange =
      25;

    sub =
      `You beat ${
        opponent?.name ||
        "your opponent"
      }. Well played!`;


  } else {

    emoji =
      "💀";

    title =
      "Defeat";

    resultClass =
      "lose";

    xpChange =
      -10;

    sub =
      `${
        opponent?.name ||
        "Your opponent"
      } got the better of you this time.`;
  }


  const emojiElement =
    document.getElementById(
      "cfResultEmoji"
    );


  const titleElement =
    document.getElementById(
      "cfResultTitle"
    );


  const subElement =
    document.getElementById(
      "cfResultSub"
    );


  const xpElement =
    document.getElementById(
      "cfXpChange"
    );


  if (emojiElement) {

    emojiElement.textContent =
      emoji;
  }


  if (titleElement) {

    titleElement.textContent =
      title;


    titleElement.className =
      "result-title " +
      resultClass;
  }


  if (subElement) {

    subElement.textContent =
      sub;
  }


  if (xpElement) {

    xpElement.textContent =
      (xpChange >= 0
        ? "+"
        : "") +
      xpChange +
      " XP";


    xpElement.className =
      "xp-change " +
      (
        xpChange >= 0
          ? "pos"
          : "neg"
      );
  }


  /*
     IMPORTANT:
     Show result immediately.
  */

  if (draw) {

    showNotification(
      "🤝 Connect Four ended in a draw!"
    );

  } else if (iWon) {

    showNotification(
      "🏆 You won Connect Four!"
    );

  } else {

    showNotification(
      `💀 ${
        opponent?.name ||
        "Your opponent"
      } won Connect Four.`
    );
  }


  showScreen(
    "cf-result"
  );


  /*
     Update player statistics.
  */

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

            id:
              myId,

            name:
              myProfile?.name ||
              "Player",

            avatar:
              myProfile?.avatar ||
              "🎮",

            xp:
              0,

            wins:
              0,

            losses:
              0,

            draws:
              0,

            played:
              0,
          };


        player.played =
          Number(
            player.played ||
            0
          ) + 1;


        if (draw) {

          player.draws =
            Number(
              player.draws ||
              0
            ) + 1;

        } else if (iWon) {

          player.wins =
            Number(
              player.wins ||
              0
            ) + 1;

        } else {

          player.losses =
            Number(
              player.losses ||
              0
            ) + 1;
        }


        player.xp =
          Math.max(
            0,

            Number(
              player.xp ||
              0
            ) +
            xpChange
          );


        return player;
      }
    );


    /*
       Refresh local profile.
    */

    const snapshot =
      await playerRef.once(
        "value"
      );


    if (
      snapshot.exists()
    ) {

      myProfile =
        snapshot.val();


      localStorage.setItem(
        "arenaProfile",
        JSON.stringify(
          myProfile
        )
      );


      applyProfileToNav();
    }


    /*
       Refresh leaderboard.
    */

    await refreshLeaderboardData();


  } catch (error) {

    console.error(
      "Connect Four stats error:",
      error
    );
  }


  /*
     Stop this player's listener.
  */

  cfCleanupRoomListener();
}


/* =========================================================
   CANCEL SEARCH / PRIVATE WAIT
   ========================================================= */

async function cancelConnectFourSearch() {

  try {

    /*
       Remove queue only if
       this player is the one waiting.
    */

    await db
      .ref(
        "queues/connectfour"
      )
      .transaction(
        (current) => {

          if (
            current?.status ===
              "waiting" &&

            current.player?.id ===
              myId
          ) {

            return null;
          }


          return current;
        }
      );


  } catch (error) {

    console.error(
      "Connect Four search cancel error:",
      error
    );
  }


  /*
     If we created a private room,
     remove it.
  */

  if (
    cfRoomId &&
    cfRoomId.startsWith(
      "cf_priv_"
    )
  ) {

    try {

      await db
        .ref(
          "rooms/" +
          cfRoomId
        )
        .remove();

    } catch (error) {

      console.error(
        "Private room cleanup error:",
        error
      );
    }
  }


  cfCleanupAllListeners();


  cfRoomId = null;
  cfMyColor = null;

  cfResultHandled =
    false;


  showScreen(
    "cf-menu"
  );
}


/* =========================================================
   LEAVE CONNECT FOUR GAME
   ========================================================= */

async function leaveConnectFourGame() {

  if (!cfRoomId) {

    closeConnectFour();

    return;
  }


  try {

    const roomRef =
      db.ref(
        "rooms/" +
        cfRoomId
      );


    await roomRef.transaction(
      (room) => {

        if (!room) {
          return;
        }


        if (
          room.game !==
          "connectfour"
        ) {
          return;
        }


        if (
          room.status ===
          "finished"
        ) {

          return room;
        }


        room.status =
          "opponent-left";


        room.leftPlayer =
          myId;


        room.leftAt =
          firebase.database
            .ServerValue
            .TIMESTAMP;


        return room;
      }
    );


  } catch (error) {

    console.error(
      "Connect Four leave error:",
      error
    );
  }


  cfCleanupAllListeners();


  cfRoomId = null;
  cfMyColor = null;

  cfResultHandled =
    false;


  showNotification(
    "You left the Connect Four game."
  );


  showScreen(
    "home"
  );
}/* =========================================================
   ARENA — SNAKES & LADDERS
   FIREBASE MULTIPLAYER
   ========================================================= */


/* =========================================================
   STATE
   ========================================================= */

let slRoomId = null;
let slMyColor = null;

let slRoomRef = null;
let slRoomCallback = null;

let slQueueRef = null;
let slQueueCallback = null;

let slPrivateRef = null;
let slPrivateCallback = null;

let slMoveInFlight = false;
let slResultHandled = false;


/* =========================================================
   BOARD CONSTANTS
   ========================================================= */

const SL_LAST = 100;


/* =========================================================
   SNAKES
   ========================================================= */

const SL_SNAKES = {

  99: 54,
  95: 75,
  92: 88,
  89: 68,
  74: 53,
  64: 60,
  62: 19,
  49: 11,
  47: 26,
  16: 6

};


/* =========================================================
   LADDERS
   ========================================================= */

const SL_LADDERS = {

  2: 38,
  7: 14,
  8: 31,
  15: 26,
  21: 42,
  28: 84,
  36: 44,
  51: 67,
  71: 91,
  78: 98

};


/* =========================================================
   OPEN / CLOSE
   ========================================================= */

function openSnakesLadders() {

  /*
     Clean only Snakes & Ladders listeners.
     Do NOT touch Tic-Tac-Toe listeners.
  */

  slCleanupAll();

  slRoomId = null;
  slMyColor = null;

  slMoveInFlight = false;
  slResultHandled = false;

  const input =
    document.getElementById(
      "slJoinCodeInput"
    );

  if (input) {
    input.value = "";
  }

  /*
     THIS IS THE IMPORTANT PART.

     Clicking the card directly opens the
     Snakes & Ladders menu.
  */

  showScreen("sl-menu");

}


function closeSnakesLadders() {

  slCleanupAll();

  slRoomId = null;
  slMyColor = null;

  slMoveInFlight = false;
  slResultHandled = false;

  showScreen("home");

}


/* =========================================================
   CLEANUP
   ========================================================= */

function slCleanupRoomListener() {

  if (
    slRoomRef &&
    slRoomCallback
  ) {

    slRoomRef.off(
      "value",
      slRoomCallback
    );

  }

  slRoomRef = null;
  slRoomCallback = null;

}


function slCleanupQueueListener() {

  if (
    slQueueRef &&
    slQueueCallback
  ) {

    slQueueRef.off(
      "value",
      slQueueCallback
    );

  }

  slQueueRef = null;
  slQueueCallback = null;

}


function slCleanupPrivateListener() {

  if (
    slPrivateRef &&
    slPrivateCallback
  ) {

    slPrivateRef.off(
      "value",
      slPrivateCallback
    );

  }

  slPrivateRef = null;
  slPrivateCallback = null;

}


function slCleanupAll() {

  slCleanupRoomListener();

  slCleanupQueueListener();

  slCleanupPrivateListener();

}


/* =========================================================
   PLAYER DATA
   ========================================================= */

function slPlayerData() {

  return {

    id: myId,

    name:
      myProfile?.name ||
      "Player",

    avatar:
      myProfile?.avatar ||
      "🎮"

  };

}


/* =========================================================
   ROOM CODE
   ========================================================= */

function slGenerateCode() {

  return Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();

}


/* =========================================================
   PRIVATE ROOM — CREATE
   ========================================================= */

async function slCreatePrivateRoom() {

  if (
    !myId ||
    !myProfile
  ) {

    alert(
      "Please finish your profile first."
    );

    return;

  }


  slCleanupAll();

  slResultHandled = false;

  let code = null;
  let roomId = null;


  /*
     Find an unused room code.
  */

  for (
    let attempt = 0;
    attempt < 10;
    attempt++
  ) {

    const candidate =
      slGenerateCode();

    const candidateId =
      "sl_priv_" +
      candidate;

    const snapshot =
      await db
        .ref(
          "rooms/" +
          candidateId
        )
        .once("value");


    if (!snapshot.exists()) {

      code = candidate;

      roomId = candidateId;

      break;

    }

  }


  if (
    !code ||
    !roomId
  ) {

    alert(
      "Could not generate room code. Try again."
    );

    return;

  }


  const room = {

    id: roomId,

    game:
      "snakes_ladders",

    code: code,

    players: {

      R:
        slPlayerData(),

      B:
        null

    },

    positions: {

      R: 1,
      B: 1

    },

    turn:
      myId,

    status:
      "waiting",

    winner:
      null,

    lastRoll:
      null,

    moveCount:
      0,

    createdAt:
      firebase.database
        .ServerValue
        .TIMESTAMP

  };


  try {

    await db
      .ref(
        "rooms/" +
        roomId
      )
      .set(room);


    slRoomId =
      roomId;

    slMyColor =
      "R";


    document.getElementById(
      "slPrivateRoomCode"
    ).textContent =
      code;


    document.getElementById(
      "slPrivateStatus"
    ).textContent =
      "Waiting for opponent…";


    showScreen(
      "sl-privatewait"
    );


    /*
       LISTEN FOR PLAYER B.

       This is the critical fix.

       The creator keeps listening to the
       actual room. As soon as B joins,
       we call slEnterRoom().
    */

    const roomRef =
      db.ref(
        "rooms/" +
        roomId
      );


    const callback =
      async (snapshot) => {

        if (
          !snapshot.exists()
        ) {

          return;

        }


        const updated =
          snapshot.val();


        /*
           Opponent joined.
        */

        if (
          updated.game ===
            "snakes_ladders" &&

          updated.status ===
            "active" &&

          updated.players?.B
        ) {

          slCleanupPrivateListener();


          /*
             IMPORTANT:

             Creator enters the board here.
          */

          await slEnterRoom(
            roomId,
            "R"
          );

        }

      };


    slPrivateRef =
      roomRef;

    slPrivateCallback =
      callback;


    roomRef.on(
      "value",
      callback
    );


  } catch (error) {

    console.error(
      "Snakes & Ladders private room error:",
      error
    );

    alert(
      "Could not create room: " +
      error.message
    );

  }

}


/* =========================================================
   PRIVATE ROOM — JOIN
   ========================================================= */

async function slJoinPrivateRoom() {

  if (
    !myId ||
    !myProfile
  ) {

    alert(
      "Please finish your profile first."
    );

    return;

  }


  const input =
    document.getElementById(
      "slJoinCodeInput"
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
    "sl_priv_" +
    code;


  const roomRef =
    db.ref(
      "rooms/" +
      roomId
    );


  try {

    /*
       Atomically add Player B.
    */

    const transaction =
      await roomRef.transaction(
        (room) => {

          if (!room) {

            return;

          }


          if (
            room.game !==
            "snakes_ladders"
          ) {

            return;

          }


          if (
            room.status !==
            "waiting"
          ) {

            return;

          }


          if (
            room.players?.B
          ) {

            return;

          }


          room.players =
            room.players || {};


          room.players.B =
            slPlayerData();


          room.status =
            "active";


          return room;

        }
      );


    if (
      !transaction.committed
    ) {

      alert(
        "Room not found or already full."
      );

      return;

    }


    /*
       We are Player B.

       Enter immediately.
    */

    slRoomId =
      roomId;

    slMyColor =
      "B";


    await slEnterRoom(
      roomId,
      "B"
    );


  } catch (error) {

    console.error(
      "Snakes & Ladders join error:",
      error
    );

    alert(
      "Could not join room: " +
      error.message
    );

  }

}


/* =========================================================
   QUICK MATCH
   ========================================================= */

async function slStartQuickMatch() {

  if (
    !myId ||
    !myProfile
  ) {

    alert(
      "Please finish your profile first."
    );

    return;

  }


  slCleanupAll();

  slResultHandled = false;

  showScreen(
    "sl-searching"
  );


  const queueRef =
    db.ref(
      "queues/snakes_ladders"
    );


  /*
     Listen BEFORE transaction.

     This means the waiting player
     doesn't miss the match.
  */

  const queueCallback =
    async (snapshot) => {

      const state =
        snapshot.val();


      if (!state) {

        return;

      }


      /*
         Another player matched with us.
      */

      if (
        state.status ===
          "matched" &&

        (
          state.creator?.id ===
            myId ||

          state.opponent?.id ===
            myId
        )
      ) {

        slCleanupQueueListener();

        await slHandleQuickMatch(
          state
        );

      }

    };


  slQueueRef =
    queueRef;

  slQueueCallback =
    queueCallback;


  queueRef.on(
    "value",
    queueCallback
  );


  try {

    const result =
      await queueRef.transaction(
        (current) => {

          /*
             Someone is already waiting.

             Match them.
          */

          if (
            current &&

            current.status ===
              "waiting" &&

            current.player?.id !==
              myId
          ) {

            return {

              status:
                "matched",

              creator:
                current.player,

              opponent:
                slPlayerData(),

              matchedAt:
                firebase.database
                  .ServerValue
                  .TIMESTAMP

            };

          }


          /*
             We are already waiting.
          */

          if (
            current &&

            current.status ===
              "waiting" &&

            current.player?.id ===
              myId
          ) {

            return current;

          }


          /*
             Become waiting player.
          */

          return {

            status:
              "waiting",

            player:
              slPlayerData(),

            createdAt:
              firebase.database
                .ServerValue
                .TIMESTAMP

          };

        }
      );


    if (
      !result.committed
    ) {

      slCleanupQueueListener();

      showScreen(
        "sl-menu"
      );

      return;

    }


    const queue =
      result.snapshot.val();


    /*
       The player who completed
       the transaction as the matcher
       handles the room creation too.
    */

    if (
      queue?.status ===
        "matched"
    ) {

      await slHandleQuickMatch(
        queue
      );

    }

  } catch (error) {

    console.error(
      "Snakes & Ladders matchmaking error:",
      error
    );

    slCleanupQueueListener();

    showScreen(
      "sl-menu"
    );

  }

}


/* =========================================================
   QUICK MATCH — CREATE ONE SHARED ROOM
   ========================================================= */

async function slHandleQuickMatch(
  state
) {

  if (
    !state?.creator ||
    !state?.opponent
  ) {

    return;

  }


  /*
     IMPORTANT:

     Both players calculate the SAME
     room ID.

     This prevents both browsers from
     creating two different rooms.
  */

  const ids = [

    state.creator.id,

    state.opponent.id

  ].sort();


  const roomId =
    "sl_match_" +
    ids[0] +
    "_" +
    ids[1];


  const roomRef =
    db.ref(
      "rooms/" +
      roomId
    );


  try {

    /*
       Only create the room if it
       doesn't already exist.
    */

    await roomRef.transaction(
      (current) => {

        if (current) {

          return current;

        }


        return {

          id:
            roomId,

          game:
            "snakes_ladders",

          players: {

            R:
              state.creator,

            B:
              state.opponent

          },

          positions: {

            R: 1,
            B: 1

          },

          turn:
            state.creator.id,

          status:
            "active",

          winner:
            null,

          lastRoll:
            null,

          moveCount:
            0,

          createdAt:
            firebase.database
              .ServerValue
              .TIMESTAMP

        };

      }
    );


    /*
       Remove queue only if it is
       still our match.
    */

    await db
      .ref(
        "queues/snakes_ladders"
      )
      .transaction(
        (current) => {

          if (
            current?.status ===
              "matched"
          ) {

            return null;

          }

          return current;

        }
      );


    /*
       Decide our color.
    */

    if (
      state.creator.id ===
      myId
    ) {

      slMyColor =
        "R";

    } else {

      slMyColor =
        "B";

    }


    slRoomId =
      roomId;


    /*
       BOTH players enter the room.

       This is what fixes the second
       player's board problem.
    */

    await slEnterRoom(
      roomId,
      slMyColor
    );


  } catch (error) {

    console.error(
      "Quick match room error:",
      error
    );

  }

}


/* =========================================================
   CANCEL SEARCH
   ========================================================= */

async function slCancelSearch() {

  slCleanupQueueListener();


  try {

    await db
      .ref(
        "queues/snakes_ladders"
      )
      .transaction(
        (current) => {

          if (
            current?.status ===
              "waiting" &&

            current.player?.id ===
              myId
          ) {

            return null;

          }


          return current;

        }
      );

  } catch (error) {

    console.error(
      "Cancel Snakes & Ladders search error:",
      error
    );

  }


  showScreen(
    "sl-menu"
  );

}


/* =========================================================
   ENTER ROOM
   ========================================================= */
/* =========================================================
   ENTER SNAKES ROOM — SAFE VERSION
   ========================================================= */

async function slEnterRoom(roomId, color) {

  if (!roomId || !myId) {
    return;
  }

  /* -----------------------------------------
     Clean ONLY Snakes listeners
  ----------------------------------------- */

  slCleanupRoomListener();
  slCleanupPrivateListener();

  slRoomId = roomId;
  slMyColor = color;

  slResultHandled = false;
  slMoveInFlight = false;

  const roomRef = db.ref("rooms/" + roomId);

  try {

    /* -----------------------------------------
       Get current room first
    ----------------------------------------- */

    const initial = await roomRef.once("value");

    if (!initial.exists()) {

      console.warn(
        "Snakes room does not exist:",
        roomId
      );

      slCleanupAll();

      slRoomId = null;
      slMyColor = null;

      showScreen("sl-menu");

      return;
    }

    const initialRoom = initial.val();

    /* -----------------------------------------
       SECURITY CHECK
       Make absolutely sure this is our game.
    ----------------------------------------- */

    if (
      initialRoom.game !==
      "snakes_ladders"
    ) {

      console.error(
        "Wrong game room:",
        initialRoom
      );

      slCleanupAll();

      slRoomId = null;
      slMyColor = null;

      showScreen("sl-menu");

      return;
    }

    /* -----------------------------------------
       Make sure WE are actually in the room.
    ----------------------------------------- */

    const myPlayer =
      initialRoom.players?.[color];

    if (
      !myPlayer ||
      myPlayer.id !== myId
    ) {

      console.error(
        "Player identity mismatch.",
        {
          expected: myId,
          color: color,
          player: myPlayer
        }
      );

      slCleanupAll();

      slRoomId = null;
      slMyColor = null;

      showScreen("sl-menu");

      return;
    }

    /* -----------------------------------------
       If both players exist → GAME
    ----------------------------------------- */

    if (
      initialRoom.players?.R &&
      initialRoom.players?.B
    ) {

      slRenderGame(initialRoom);

    } else {

      showScreen("sl-privatewait");

    }

    /* -----------------------------------------
       REALTIME LISTENER
    ----------------------------------------- */

    const callback = async (snapshot) => {

      if (!snapshot.exists()) {
        return;
      }

      const room = snapshot.val();

      /* ---------------------------------------
         NEVER react to another game
      --------------------------------------- */

      if (
        room.game !==
        "snakes_ladders"
      ) {
        return;
      }

      /* ---------------------------------------
         Verify our player still exists
      --------------------------------------- */

      const currentMe =
        room.players?.[slMyColor];

      if (
        !currentMe ||
        currentMe.id !== myId
      ) {

        console.warn(
          "Snakes player disappeared from room."
        );

        return;
      }

      /* ---------------------------------------
         OPPONENT LEFT
         
         Only accept it if:
         - status says opponent-left
         - leftPlayer exists
         - leftPlayer is NOT us
      --------------------------------------- */

      if (
        room.status ===
        "opponent-left"
      ) {

        if (
          room.leftPlayer &&
          room.leftPlayer !== myId
        ) {

          if (slResultHandled) {
            return;
          }

          slResultHandled = true;

          showNotification(
            "Your opponent left the room."
          );

          slCleanupRoomListener();

          setTimeout(() => {

            slRoomId = null;
            slMyColor = null;
            slMoveInFlight = false;

            showScreen("home");

          }, 1200);

        }

        return;
      }

      /* ---------------------------------------
         FINISHED
      --------------------------------------- */

      if (
        room.status ===
        "finished"
      ) {

        await slHandleGameEnd(room);

        return;
      }

      /* ---------------------------------------
         ACTIVE GAME
      --------------------------------------- */

      if (
        room.status === "active" &&
        room.players?.R &&
        room.players?.B
      ) {

        slRenderGame(room);

      }

    };

    /* -----------------------------------------
       Save listener references
    ----------------------------------------- */

    slRoomRef = roomRef;
    slRoomCallback = callback;

    /* -----------------------------------------
       Start listener
    ----------------------------------------- */

    roomRef.on(
      "value",
      callback
    );

  } catch (error) {

    console.error(
      "SNAKES ENTER ROOM ERROR:",
      error
    );

    slCleanupAll();

    slRoomId = null;
    slMyColor = null;
    slMoveInFlight = false;

    showNotification(
      "Could not open the game."
    );

    showScreen("sl-menu");
  }

}


/* =========================================================
   RENDER GAME
   ========================================================= */

function slRenderGame(
  room
) {

  if (
    !room ||
    !room.players?.R ||
    !room.players?.B
  ) {

    return;

  }


  /*
     OPEN THE BOARD.

     This means the board is shown as
     soon as both players exist.
  */

  showScreen(
    "snakes"
  );


  /*
     Determine players.
  */

  const me =
    room.players?.[
      slMyColor
    ];


  const opponentColor =
    slMyColor === "R"
      ? "B"
      : "R";


  const opponent =
    room.players?.[
      opponentColor
    ];


  const myPosition =
    Number(
      room.positions?.[
        slMyColor
      ] || 1
    );


  const opponentPosition =
    Number(
      room.positions?.[
        opponentColor
      ] || 1
    );


  /*
     Names.
  */
/* -----------------------------------------
   Update player token colors
----------------------------------------- */

const myToken =
  document.querySelector(
    "#slMeCard .sl-player-token"
  );

const opponentToken =
  document.querySelector(
    "#slOpponentCard .sl-player-token"
  );

if (myToken) {

  myToken.textContent =
    slMyColor === "R"
      ? "🔴"
      : "🔵";

}

if (opponentToken) {

  opponentToken.textContent =
    opponentColor === "R"
      ? "🔴"
      : "🔵";

}
  const myName =
    document.getElementById(
      "slMyName"
    );


  const opponentName =
    document.getElementById(
      "slOpponentName"
    );


  const myPos =
    document.getElementById(
      "slMyPosition"
    );


  const opponentPos =
    document.getElementById(
      "slOpponentPosition"
    );


  if (myName) {

    myName.textContent =
      me?.name ||
      "You";

  }


  if (opponentName) {

    opponentName.textContent =
      opponent?.name ||
      "Opponent";

  }


  if (myPos) {

    myPos.textContent =
      "Position: " +
      myPosition;

  }


  if (opponentPos) {

    opponentPos.textContent =
      "Position: " +
      opponentPosition;

  }


  /*
     Turn.
  */

  const banner =
    document.getElementById(
      "slTurnBanner"
    );


  const rollButton =
    document.getElementById(
      "slRollBtn"
    );


  const isMyTurn =
    room.turn ===
    myId;


  if (banner) {

    banner.textContent =
      isMyTurn
        ? "🎲 Your turn"
        : "⏳ Opponent's turn";

  }


  if (rollButton) {

    rollButton.disabled =
      !isMyTurn ||
      slMoveInFlight;

  }


  /*
     Last dice result.
  */

  const diceResult =
    document.getElementById(
      "slDiceResult"
    );


  if (
    diceResult &&
    room.lastRoll
  ) {

    const roller =
      room.lastRoll.player ===
      myId

        ? "You"

        : (
            opponent?.name ||
            "Opponent"
          );


    let text =
      `${roller} rolled ${room.lastRoll.value}`;


    /*
       Show snake / ladder result.
    */

    if (
      room.lastRoll.to !==
      room.lastRoll.from +
      room.lastRoll.value
    ) {

      if (
        SL_LADDERS[
          room.lastRoll.from +
          room.lastRoll.value
        ]
      ) {

        text +=
          " 🪜 Ladder!";

      }

      else if (
        SL_SNAKES[
          room.lastRoll.from +
          room.lastRoll.value
        ]
      ) {

        text +=
          " 🐍 Snake!";

      }

    }


    diceResult.textContent =
      text;

  }


  /*
     Render board.
  */

  slRenderBoard(
    room
  );

}


/* =========================================================
   RENDER BOARD
   ========================================================= */
/* =========================================================
   SVG SNAKES & LADDERS BOARD
   ========================================================= */

function slRenderBoard(room) {
  const svg = document.getElementById("slSvgBoard");

  if (!svg) return;

  svg.innerHTML = "";

  const NS = "http://www.w3.org/2000/svg";

  /* -------------------------------------------------------
     CREATE SVG ELEMENT
     ------------------------------------------------------- */

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(NS, tag);

    Object.entries(attrs).forEach(([key, value]) => {
      el.setAttribute(key, value);
    });

    return el;
  }

  /* -------------------------------------------------------
     BOARD COORDINATES

     10 x 10
     serpentine numbering:

     100 99 98 ... 91
      81 82 83 ... 90
      ...
       1  2  3 ... 10
     ------------------------------------------------------- */

  function getCellPosition(number) {
    const zero = number - 1;

    const rowFromBottom = Math.floor(zero / 10);

    const positionInRow = zero % 10;

    let col;

    if (rowFromBottom % 2 === 0) {
      col = positionInRow;
    } else {
      col = 9 - positionInRow;
    }

    const rowFromTop = 9 - rowFromBottom;

    return {
      x: col * 100 + 50,
      y: rowFromTop * 100 + 50
    };
  }

  /* -------------------------------------------------------
     BOARD BACKGROUND
     ------------------------------------------------------- */

  const boardBg = svgEl("rect", {
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    rx: 18,
    fill: "#0d0b22"
  });

  svg.appendChild(boardBg);

  /* -------------------------------------------------------
     CELLS
     ------------------------------------------------------- */

  for (let number = 1; number <= 100; number++) {
    const pos = getCellPosition(number);

    const zero = number - 1;

    const rowFromBottom = Math.floor(zero / 10);
    const positionInRow = zero % 10;

    let col;

    if (rowFromBottom % 2 === 0) {
      col = positionInRow;
    } else {
      col = 9 - positionInRow;
    }

    const rowFromTop = 9 - rowFromBottom;

    const rect = svgEl("rect", {
      x: col * 100,
      y: rowFromTop * 100,
      width: 100,
      height: 100,
      class:
        number === 1
          ? "sl-svg-cell sl-svg-start"
          : number === 100
            ? "sl-svg-cell sl-svg-finish"
            : "sl-svg-cell"
    });

    svg.appendChild(rect);

    const text = svgEl("text", {
      x: col * 100 + 12,
      y: rowFromTop * 100 + 28,
      class: "sl-svg-number"
    });

    text.textContent = number;

    svg.appendChild(text);
  }

  /* -------------------------------------------------------
     CENTER POINT OF A CELL
     ------------------------------------------------------- */

  function cell(number) {
    return getCellPosition(number);
  }

  /* =======================================================
     LADDERS
     ======================================================= */

  Object.entries(SL_LADDERS).forEach(([from, to]) => {
    from = Number(from);
    to = Number(to);

    const start = cell(from);
    const end = cell(to);

    drawLadder(start, end);
  });

  function drawLadder(start, end) {
    /*
      Vector from bottom → top
    */

    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const length = Math.sqrt(dx * dx + dy * dy);

    if (!length) return;

    const nx = -dy / length;
    const ny = dx / length;

    const offset = 20;

    /* rails */

    const rail1Start = {
      x: start.x + nx * offset,
      y: start.y + ny * offset
    };

    const rail1End = {
      x: end.x + nx * offset,
      y: end.y + ny * offset
    };

    const rail2Start = {
      x: start.x - nx * offset,
      y: start.y - ny * offset
    };

    const rail2End = {
      x: end.x - nx * offset,
      y: end.y - ny * offset
    };

    const rail1 = svgEl("line", {
      x1: rail1Start.x,
      y1: rail1Start.y,
      x2: rail1End.x,
      y2: rail1End.y,
      class: "sl-ladder-rail"
    });

    const rail2 = svgEl("line", {
      x1: rail2Start.x,
      y1: rail2Start.y,
      x2: rail2End.x,
      y2: rail2End.y,
      class: "sl-ladder-rail"
    });

    svg.appendChild(rail1);
    svg.appendChild(rail2);

    /* rungs */

    const rungCount = Math.max(
      4,
      Math.floor(length / 55)
    );

    for (let i = 1; i < rungCount; i++) {
      const t = i / rungCount;

      const centerX =
        start.x + dx * t;

      const centerY =
        start.y + dy * t;

      const rung = svgEl("line", {
        x1: centerX + nx * offset,
        y1: centerY + ny * offset,
        x2: centerX - nx * offset,
        y2: centerY - ny * offset,
        class: "sl-ladder-rung"
      });

      svg.appendChild(rung);
    }
  }

  /* =======================================================
     SNAKES
     ======================================================= */

  Object.entries(SL_SNAKES).forEach(([from, to], index) => {
    from = Number(from);
    to = Number(to);

    const start = cell(from);
    const end = cell(to);

    drawSnake(start, end, index);
  });

  function drawSnake(start, end, index) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;

    const distance = Math.sqrt(
      dx * dx + dy * dy
    );

    /*
      Perpendicular direction
      creates the snake's curves.
    */

    const px = -dy / distance;
    const py = dx / distance;

    const curveAmount =
      35 + (index % 3) * 18;

    const direction =
      index % 2 === 0 ? 1 : -1;

    const c1x =
      start.x +
      dx * 0.28 +
      px * curveAmount * direction;

    const c1y =
      start.y +
      dy * 0.28 +
      py * curveAmount * direction;

    const c2x =
      start.x +
      dx * 0.72 -
      px * curveAmount * direction;

    const c2y =
      start.y +
      dy * 0.72 -
      py * curveAmount * direction;

    const pathData = `
      M ${start.x} ${start.y}
      C
      ${c1x} ${c1y},
      ${c2x} ${c2y},
      ${end.x} ${end.y}
    `;

    /* main snake */

    const snake = svgEl("path", {
      d: pathData,
      class: "sl-snake-body"
    });

    svg.appendChild(snake);

    /* highlight */

    const highlight = svgEl("path", {
      d: pathData,
      class: "sl-snake-highlight"
    });

    svg.appendChild(highlight);

    /* snake head */

    drawSnakeHead(start, dx, dy);

    /* tongue */

    drawSnakeTongue(start, dx, dy);
  }

  /* -------------------------------------------------------
     SNAKE HEAD
     ------------------------------------------------------- */

  function drawSnakeHead(pos, dx, dy) {
    const angle =
      Math.atan2(dy, dx) * 180 / Math.PI;

    const group = svgEl("g", {
      transform:
        `translate(${pos.x} ${pos.y}) rotate(${angle})`
    });

    const head = svgEl("ellipse", {
      cx: 0,
      cy: 0,
      rx: 32,
      ry: 25,
      fill: "#ff4d97",
      stroke: "#ff9fc5",
      "stroke-width": 3
    });

    group.appendChild(head);

    /* eyes */

    const eye1 = svgEl("circle", {
      cx: 13,
      cy: -10,
      r: 6,
      class: "sl-snake-eye"
    });

    const eye2 = svgEl("circle", {
      cx: 13,
      cy: 10,
      r: 6,
      class: "sl-snake-eye"
    });

    const pupil1 = svgEl("circle", {
      cx: 15,
      cy: -10,
      r: 2.5,
      class: "sl-snake-pupil"
    });

    const pupil2 = svgEl("circle", {
      cx: 15,
      cy: 10,
      r: 2.5,
      class: "sl-snake-pupil"
    });

    group.appendChild(eye1);
    group.appendChild(eye2);

    group.appendChild(pupil1);
    group.appendChild(pupil2);

    svg.appendChild(group);
  }

  /* -------------------------------------------------------
     TONGUE
     ------------------------------------------------------- */

  function drawSnakeTongue(pos, dx, dy) {
    const angle =
      Math.atan2(dy, dx);

    const tx =
      pos.x + Math.cos(angle) * 33;

    const ty =
      pos.y + Math.sin(angle) * 33;

    const tx2 =
      pos.x + Math.cos(angle) * 55;

    const ty2 =
      pos.y + Math.sin(angle) * 55;

    const tongue = svgEl("path", {
      d: `
        M ${tx} ${ty}
        L ${tx2} ${ty2}
        M ${tx2} ${ty2}
        L ${tx2 + 8} ${ty2 - 7}
        M ${tx2} ${ty2}
        L ${tx2 + 8} ${ty2 + 7}
      `,
      class: "sl-snake-tongue"
    });

    svg.appendChild(tongue);
  }

  /* =======================================================
     TOKENS
     ======================================================= */

  if (room?.positions) {
    drawToken(
      room.positions.R,
      "red",
      room.players?.R?.avatar || "R"
    );

    drawToken(
      room.positions.B,
      "blue",
      room.players?.B?.avatar || "B"
    );
  }

  function drawToken(number, color, label) {
    if (!number) return;

    const pos = cell(number);

    const group = svgEl("g", {
      class:
        `sl-svg-token sl-token-${color}`,
      transform:
        `translate(${pos.x} ${pos.y})`
    });

    /*
      token shadow
    */

    const shadow = svgEl("ellipse", {
      cx: 0,
      cy: 17,
      rx: 25,
      ry: 8,
      fill: "rgba(0,0,0,0.45)"
    });

    group.appendChild(shadow);

    /*
      token body
    */

    const tokenColor =
      color === "red"
        ? "#ff4d97"
        : "#3fe0d0";

    const lightColor =
      color === "red"
        ? "#ffb5d3"
        : "#b8fff7";

    const body = svgEl("path", {
      d: `
        M -20 12
        Q -23 30 0 32
        Q 23 30 20 12
        Z

        M -15 12
        Q -11 -4 0 -13
        Q 11 -4 15 12
        Z
      `,
      fill: tokenColor,
      stroke: "rgba(255,255,255,0.65)",
      "stroke-width": 2
    });

    group.appendChild(body);

    /*
      token shine
    */

    const shine = svgEl("ellipse", {
      cx: -7,
      cy: -5,
      rx: 5,
      ry: 8,
      fill: lightColor,
      opacity: 0.7
    });

    group.appendChild(shine);

    svg.appendChild(group);
  }
}


/* =========================================================
   ROLL DICE
   ========================================================= */

async function slRollDice() {

  if (
    !slRoomId ||
    !slMyColor ||
    slMoveInFlight
  ) {

    return;

  }


  slMoveInFlight =
    true;


  const dice =
    document.getElementById(
      "slDice"
    );


  if (dice) {

    dice.classList.remove(
      "rolling"
    );


    void dice.offsetWidth;


    dice.classList.add(
      "rolling"
    );

  }


  try {

    const roomRef =
      db.ref(
        "rooms/" +
        slRoomId
      );


    /*
       TRANSACTION.

       This makes sure two browsers
       cannot roll at the same time.
    */

    const result =
      await roomRef.transaction(
        (room) => {

          if (!room) {

            return;

          }


          if (
            room.status !==
            "active"
          ) {

            return;

          }


          if (
            room.turn !==
            myId
          ) {

            return;

          }


          /*
             Roll 1-6.
          */

          const roll =
            Math.floor(
              Math.random() * 6
            ) + 1;


          const oldPosition =
            Number(
              room.positions?.[
                slMyColor
              ] || 1
            );


          /*
             Move.
          */

          let newPosition =
            oldPosition +
            roll;


          /*
             Exact 100 rule.

             If the roll goes beyond 100,
             player stays where they are.
          */

          if (
            newPosition >
            SL_LAST
          ) {

            newPosition =
              oldPosition;

          }


          /*
             Ladder.
          */

          const landedOn =
            newPosition;


          if (
            SL_LADDERS[
              newPosition
            ]
          ) {

            newPosition =
              SL_LADDERS[
                newPosition
              ];

          }


          /*
             Snake.
          */

          else if (
            SL_SNAKES[
              newPosition
            ]
          ) {

            newPosition =
              SL_SNAKES[
                newPosition
              ];

          }


          /*
             Save position.
          */

          room.positions =
            room.positions ||
            {};


          room.positions[
            slMyColor
          ] =
            newPosition;


          /*
             Save dice information.
          */

          room.lastRoll = {

            value:
              roll,

            player:
              myId,

            from:
              oldPosition,

            landedOn:
              landedOn,

            to:
              newPosition,

            timestamp:
              firebase.database
                .ServerValue
                .TIMESTAMP

          };


          room.moveCount =
            Number(
              room.moveCount ||
              0
            ) + 1;


          /*
             WIN.
          */

          if (
            newPosition ===
            SL_LAST
          ) {

            room.status =
              "finished";


            room.winner =
              myId;


            return room;

          }


          /*
             Switch turn.
          */

          const opponentColor =
            slMyColor === "R"
              ? "B"
              : "R";


          const opponent =
            room.players?.[
              opponentColor
            ];


          if (
            opponent?.id
          ) {

            room.turn =
              opponent.id;

          }


          return room;

        }
      );


    if (
      !result.committed
    ) {

      console.log(
        "Dice roll rejected."
      );

    }


  } catch (error) {

    console.error(
      "Snakes & Ladders roll error:",
      error
    );

  }


  /*
     Allow next roll after the current
     transaction has completed.
  */

  setTimeout(() => {

    slMoveInFlight =
      false;


  }, 350);

}


/* =========================================================
   GAME END
   ========================================================= */

async function slHandleGameEnd(
  room
) {

  if (
    !room ||
    room.status !==
      "finished" ||
    slResultHandled
  ) {

    return;

  }


  slResultHandled =
    true;


  slCleanupRoomListener();


  const iWon =
    room.winner ===
    myId;


  const opponentColor =
    slMyColor === "R"
      ? "B"
      : "R";


  const opponent =
    room.players?.[
      opponentColor
    ];


  const xpChange =
    iWon
      ? 25
      : -10;


  const emoji =
    document.getElementById(
      "slResultEmoji"
    );


  const title =
    document.getElementById(
      "slResultTitle"
    );


  const sub =
    document.getElementById(
      "slResultSub"
    );


  const xp =
    document.getElementById(
      "slXpChange"
    );


  if (iWon) {

    if (emoji) {

      emoji.textContent =
        "🏆";

    }


    if (title) {

      title.textContent =
        "Victory!";

      title.className =
        "result-title win";

    }


    if (sub) {

      sub.textContent =
        `You reached 100 before ${
          opponent?.name ||
          "your opponent"
        }!`;

    }


    showNotification(
      "🏆 You reached 100 and won!"
    );


  } else {

    if (emoji) {

      emoji.textContent =
        "💀";

    }


    if (title) {

      title.textContent =
        "Defeat";

      title.className =
        "result-title lose";

    }


    if (sub) {

      sub.textContent =
        `${
          opponent?.name ||
          "Your opponent"
        } reached 100 first.`;

    }


    showNotification(
      `💀 ${
        opponent?.name ||
        "Your opponent"
      } won the game.`
    );

  }


  if (xp) {

    xp.textContent =
      (
        xpChange >= 0
          ? "+"
          : ""
      ) +
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


  showScreen(
    "sl-result"
  );


  /*
     Update stats.

     Uses the same player structure
     as the rest of Arena.
  */

  try {

    const playerRef =
      db.ref(
        "players/" +
        myId
      );


    await playerRef.transaction(
      (player) => {

        player =
          player ||
          {

            id:
              myId,

            name:
              myProfile?.name ||
              "Player",

            avatar:
              myProfile?.avatar ||
              "🎮",

            xp:
              0,

            wins:
              0,

            losses:
              0,

            draws:
              0,

            played:
              0

          };


        player.played =
          Number(
            player.played ||
            0
          ) + 1;


        if (iWon) {

          player.wins =
            Number(
              player.wins ||
              0
            ) + 1;

        } else {

          player.losses =
            Number(
              player.losses ||
              0
            ) + 1;

        }


        player.xp =
          Math.max(
            0,

            Number(
              player.xp ||
              0
            ) +
            xpChange

          );


        return player;

      }
    );


    /*
       Refresh local profile.
    */

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


      /*
         Your existing function.
      */

      if (
        typeof applyProfileToNav ===
        "function"
      ) {

        applyProfileToNav();

      }

    }


    /*
       Your existing leaderboard
       function.
    */

    if (
      typeof refreshLeaderboardData ===
      "function"
    ) {

      await refreshLeaderboardData();

    }


  } catch (error) {

    console.error(
      "Snakes & Ladders result update error:",
      error
    );

  }

}


/* =========================================================
   LEAVE GAME
   ========================================================= */

async function slLeaveGame() {

  if (!slRoomId) {

    closeSnakesLadders();

    return;

  }


  const roomId =
    slRoomId;


  const color =
    slMyColor;


  const roomRef =
    db.ref(
      "rooms/" +
      roomId
    );


  try {

    await roomRef.transaction(
      (room) => {

        if (!room) {

          return;

        }


        if (
          room.status !==
          "active"
        ) {

          return room;

        }


        const opponentColor =
          color === "R"
            ? "B"
            : "R";


        const opponent =
          room.players?.[
            opponentColor
          ];


        if (
          opponent?.id
        ) {

          room.status =
            "opponent-left";


          room.leftPlayer =
            myId;


          room.leftAt =
            firebase.database
              .ServerValue
              .TIMESTAMP;

        }


        return room;

      }
    );

  } catch (error) {

    console.error(
      "Leave Snakes & Ladders error:",
      error
    );

  }


  slCleanupAll();


  slRoomId =
    null;

  slMyColor =
    null;

  slResultHandled =
    false;

  slMoveInFlight =
    false;


  showScreen(
    "home"
  );

}


/* =========================================================
   CANCEL PRIVATE ROOM
   ========================================================= */

async function slCancelPrivateRoom() {

  const roomId =
    slRoomId;


  /*
     Stop listener BEFORE deleting room.
  */

  slCleanupAll();


  if (roomId) {

    try {

      await db
        .ref(
          "rooms/" +
          roomId
        )
        .remove();

    } catch (error) {

      console.error(
        "Private room cleanup error:",
        error
      );

    }

  }


  slRoomId =
    null;

  slMyColor =
    null;

  slResultHandled =
    false;


  showScreen(
    "sl-menu"
  );

}