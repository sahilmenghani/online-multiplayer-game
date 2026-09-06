/* =========================================================
   ARENA — FIREBASE MULTIPLAYER
   TIC-TAC-TOE
   Optimized single implementation
   UI / HTML / CSS untouched
   ========================================================= */


/* =========================================================
   FIREBASE CONFIG
   ========================================================= */

const firebaseConfig = { apiKey: "AIzaSyALkP001EFoAmixfUDHG6dr8rPLY5jZyBU", authDomain: "online-multiplayer-game-87d66.firebaseapp.com", databaseURL: "https://online-multiplayer-game-87d66-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "online-multiplayer-game-87d66", storageBucket: "online-multiplayer-game-87d66.firebasestorage.app", messagingSenderId: "448318086824", appId: "1:448318086824:web:74c57d238eddced1332c9d", measurementId: "G-EZ5SBVLWWZ", }; if (!firebase.apps.length) { firebase.initializeApp(firebaseConfig); } const auth = firebase.auth(); const db = firebase.database();
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

let presenceRef = null;

let resultHandled = false;
let lastRoomState = "";


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
    .forEach((screen) => screen.classList.remove("active"));

  const target = document.getElementById("screen-" + name);

  if (target) {
    target.classList.add("active");
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}


function goHome() {
  cancelSearch();
  showScreen("home");
}


function openGameMenu() {
  showScreen("gamemenu");
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
        .forEach((item) => item.classList.remove("selected"));

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
    alert("Could not save profile: " + error.message);
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
   QUICK MATCH
   ========================================================= */

async function startQuickMatch() {
  if (!myId || !myProfile) {
    alert(
      "Please finish your profile first."
    );
    return;
  }

  cleanupQueueListener();

  showScreen("searching");

  const searchSub =
    document.getElementById("searchSub");

  if (searchSub) {
    searchSub.textContent =
      "Scanning the arena across India…";
  }

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
             Become waiting player.
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
             Create matched state.
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


      /*
         Queue disappeared.
         Search rooms for our player.
      */

      if (!state) {
        await recoverExistingRoom();
        return;
      }


      /*
         Match found.
      */

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

        cleanupQueueListener();


        /*
           Creator makes the room.
        */

        if (isCreator) {
          await createMatchFromWaitingPlayer(
            state.opponent,
            state.roomId
          );

          return;
        }


        /*
           Waiting player waits for room.
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


  /*
     Immediate check.
  */

  const immediate =
    await queueRef.once("value");

  await checkQueue(immediate);
}


async function recoverExistingRoom() {
  try {
    const snapshot =
      await db.ref("rooms").once("value");

    let foundRoom = null;

    snapshot.forEach((child) => {
      const room = child.val();

      if (
        room &&
        room.game === "tictactoe" &&
        room.status === "active" &&
        room.players?.X &&
        room.players?.O &&
        (
          room.players.X.id === myId ||
          room.players.O.id === myId
        )
      ) {
        foundRoom = room;
      }
    });

    if (!foundRoom) return;

    cleanupQueueListener();

    const symbol =
      foundRoom.players.X.id === myId
        ? "X"
        : "O";

    await enterRoom(
      foundRoom.id,
      symbol
    );

  } catch (error) {
    console.error(
      "Room recovery error:",
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
    /*
       Create room first.
    */

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
       Remove queue only after
       room successfully exists.
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


    /*
       Creator enters as O.
    */

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
  cleanupQueueListener();

  if (!myId) {
    showScreen("gamemenu");
    return;
  }

  try {

    /*
       Remove only our own
       waiting queue entry.
    */

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

  let code = null;
  let roomId = null;


  /*
     Try several random codes.
  */

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
      roomId = "priv_" + candidate;
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

    const codeElement =
      document.getElementById(
        "privateRoomCode"
      );

    if (codeElement) {
      codeElement.textContent =
        code;
    }

    showScreen("privatewait");


    /*
       Clean previous listener.
    */

    cleanupPrivateRoomListener();


    const roomRef =
      db.ref("rooms/" + roomId);

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
      .ref("rooms/" + currentRoomId)
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
    alert("Enter a room code.");
    return;
  }

  const roomId =
    "priv_" + code;

  const roomRef =
    db.ref("rooms/" + roomId);


  try {
    const transaction =
      await roomRef.transaction(
        (room) => {

          if (!room) {
            return;
          }

          if (
            room.status !== "waiting"
          ) {
            return;
          }

          if (
            room.players?.X?.id === myId
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


    if (!transaction.committed) {
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

  /*
     Stop previous room listener.
  */

  cleanupRoomListener();

  cleanupPrivateRoomListener();

  currentRoomId = roomId;
  mySymbol = symbol;

  resultHandled = false;
  lastRoomState = "";


  try {
    const snapshot =
      await db
        .ref("rooms/" + roomId)
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
      getOpponentSymbol(symbol);

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

        /*
           Make sure the room still exists.
        */

        const latest =
          await db
            .ref("rooms/" + roomId)
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
    getOpponentSymbol(symbol);

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
      opponent.name;

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
      .ref("players/" + me.id)
      .once("value"),

    db
      .ref("players/" + opponent.id)
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
```js
function renderBoard(room, symbol) {
  const board = document.getElementById("board");

  if (!board) {
    console.error("ARENA: #board not found");
    return;
  }

  board.innerHTML = "";

  const boardData = Array.isArray(room.board)
    ? room.board
    : Array(9).fill(null);

  const isMyTurn =
    room.status === "active" &&
    room.turn === myId;

  // Turn banner
  const banner = document.getElementById("turnBanner");

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
      banner.textContent = isMyTurn
        ? "Your turn"
        : "Opponent's turn…";
    }
  }

  // Player cards
  const meCard = document.getElementById("meCard");
  const opponentCard = document.getElementById("opponentCard");

  if (meCard) {
    meCard.classList.toggle("active-turn", isMyTurn);
  }

  if (opponentCard) {
    opponentCard.classList.toggle(
      "active-turn",
      !isMyTurn && room.status === "active"
    );
  }

  // Create 9 cells
  for (let index = 0; index < 9; index++) {
    const value = boardData[index] || "";

    const cell = document.createElement("div");

    cell.className = "cell";
    cell.dataset.index = index;

    // Existing X/O
    if (value) {
      cell.classList.add("filled");
      cell.classList.add(value.toLowerCase());
      cell.textContent = value;
    }

    // Winning line
    if (
      room.winLine &&
      room.winLine.includes(index)
    ) {
      cell.classList.add("win");
    }

    /*
      IMPORTANT:
      Every empty cell gets a click handler.
      makeMove() itself decides whether the move
      is actually allowed.
    */
    if (!value && room.status === "active") {
      cell.onclick = function () {
        console.log("CELL CLICKED:", index);

        makeMove(index, mySymbol);
      };
    }

    board.appendChild(cell);
  }

  console.log("BOARD RENDERED:", {
    room: currentRoomId,
    myId,
    mySymbol,
    firebaseTurn: room.turn,
    isMyTurn,
    board: boardData
  });
}
```

function setupBoardClicks() {
  const board = document.getElementById("board");

  if (!board) {
    console.error("ARENA: #board not found");
    return;
  }

  // Prevent duplicate listeners.
  if (board.dataset.clickReady === "true") {
    return;
  }

  board.dataset.clickReady = "true";

  board.addEventListener("click", (event) => {
    const cell = event.target.closest(".cell");

    if (!cell || !board.contains(cell)) {
      return;
    }

    const index = Number(cell.dataset.index);

    if (!Number.isInteger(index)) {
      return;
    }

    console.log(
      "ARENA CLICK:",
      index,
      "room:",
      currentRoomId,
      "myId:",
      myId,
      "symbol:",
      mySymbol
    );

    makeMove(index, mySymbol);
  });
}
/* =========================================================
   WINNER CHECK
   ========================================================= */

function checkWinner(board) {
  for (const line of WIN_LINES) {

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


  /*
     Draw.
  */

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

async function makeMove(index, symbol) {
  symbol = mySymbol;

  console.log("MAKE MOVE:", {
    index,
    symbol,
    currentRoomId,
    myId,
    mySymbol
  });

  // rest of your existing makeMove code...

  if (!currentRoomId || !myId) {
    console.error("MOVE BLOCKED: missing room or player ID");
    return;
  }

  if (index < 0 || index > 8) {
    console.error("MOVE BLOCKED: invalid index", index);
    return;
  }

  if (!symbol) {
    console.error("MOVE BLOCKED: symbol is missing");
    return;
  }

  const roomRef = db.ref(
    "rooms/" + currentRoomId
  );

  try {
    const result = await roomRef.transaction((room) => {

      if (!room) {
        console.error("MOVE BLOCKED: room doesn't exist");
        return;
      }

      if (room.status !== "active") {
        console.error(
          "MOVE BLOCKED: room status =",
          room.status
        );
        return;
      }

      if (room.turn !== myId) {
        console.error(
          "MOVE BLOCKED: not your turn",
          {
            roomTurn: room.turn,
            myId: myId
          }
        );
        return;
      }

      if (!Array.isArray(room.board)) {
        console.error("MOVE BLOCKED: invalid board");
        return;
      }

      if (room.board[index]) {
        console.error(
          "MOVE BLOCKED: cell already occupied"
        );
        return;
      }

      if (
        !room.players?.[symbol] ||
        room.players[symbol].id !== myId
      ) {
        console.error(
          "MOVE BLOCKED: symbol doesn't belong to player",
          {
            symbol,
            player: room.players?.[symbol]
          }
        );
        return;
      }

      // MAKE MOVE
      room.board[index] = symbol;

      room.moveCount =
        Number(room.moveCount || 0) + 1;

      const winner = checkWinner(room.board);

      if (winner) {
        room.status = "finished";
        room.winLine = winner.line;

        if (winner.symbol === "draw") {
          room.winner = "draw";
        } else {
          room.winner =
            room.players[winner.symbol].id;
        }

        room.finishedAt =
          firebase.database.ServerValue.TIMESTAMP;

      } else {
        const nextSymbol =
          getOpponentSymbol(symbol);

        room.turn =
          room.players[nextSymbol].id;
      }

      return room;
    });

    if (!result.committed) {
      console.error(
        "MOVE NOT COMMITTED — Firebase transaction rejected."
      );
      return;
    }

    const updatedRoom =
      result.snapshot.val();

    console.log(
      "MOVE SUCCESS:",
      updatedRoom
    );

    renderBoard(
      updatedRoom,
      symbol
    );

    if (
      updatedRoom.status === "finished"
    ) {
      await handleGameEnd(
        updatedRoom,
        symbol
      );
    }

  } catch (error) {
    console.error(
      "FIREBASE MOVE ERROR:",
      error
    );

    alert(
      "Move failed: " +
      error.message
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
      "rooms/" + roomId
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
         Avoid rendering the exact
         same state repeatedly.
      */

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


      /*
         Update game UI.
      */

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


      /*
         Game ended.
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
   GAME END
   ========================================================= */

async function handleGameEnd(
  room,
  symbol
) {
  /*
     Prevent duplicate XP rewards
     from local + realtime events.
  */

  if (resultHandled) {
    return;
  }

  resultHandled = true;


  /*
     Stop listener.
  */

  cleanupRoomListener();


  const iWon =
    room.winner === myId;

  const draw =
    room.winner === "draw";


  const opponentSymbol =
    getOpponentSymbol(
      symbol
    );

  const opponent =
    getPlayer(
      room,
      opponentSymbol
    );


  /*
     XP calculation.
  */

  let xpChange = 0;

  if (draw) {
    xpChange = 5;
  } else if (iWon) {
    xpChange = 25;
  } else {
    xpChange = -10;
  }


  /*
     Update our profile atomically.
  */

  const playerRef =
    db.ref(
      "players/" + myId
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


    /*
       Get updated profile.
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
    }

  } catch (error) {

    console.error(
      "Game result update error:",
      error
    );
  }


  /*
     Result UI.
  */

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


  /*
     Refresh leaderboard.
  */

  await refreshLeaderboardData();
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
       Load cloud profile.
    */

    const cloudSnapshot =
      await db
        .ref("players/" + myId)
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
              "players/" + myId
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
setupBoardClicks();
    startPresence();


    /*
       Leaderboard.
    */

    await refreshLeaderboardData();


    /*
       Periodic leaderboard update.
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
       Presence.
    */

    if (presenceRef) {
      presenceRef.remove();
    }


    /*
       Queue.
    */

    cleanupQueueListener();


    /*
       Room.
    */

    cleanupRoomListener();


    /*
       Private room.
    */

    cleanupPrivateRoomListener();
  }
);


/* =========================================================
   START APPLICATION
   ========================================================= */

boot();