import React, { useEffect, useMemo, useRef, useState } from "react";
import { GoogleGenAI } from "@google/genai";
import "./App.css";

import { auth, db } from "./firebase";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";

import {
  collection,
  doc,
  setDoc,
  addDoc,
  getDocs,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "firebase/firestore";

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😭", "😡", "😱"];
const BOT_ID = "chatbot";
const BOT_EMAIL = "chatbot@gemini.ai";
const BOT_NAME = "Gemini Bot";

function buildUserProfile(firebaseUser) {
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    username:
      firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
    phone: "",
    address: "",
    profilePicture: firebaseUser.photoURL || ""
  };
}

function getSender(message) {
  return message.senderName || message.senderEmail || "Unknown";
}

function getReplyPreview(message) {
  return {
    id: message.id,
    text: message.type === "image" ? "Image" : message.text,
    senderName: getSender(message)
  };
}

function getMessageHistory(roomId) {
  return collection(db, "chatrooms", roomId, "messages");
}

function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState("login");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [profile, setProfile] = useState(null);
  const [showProfile, setShowProfile] = useState(false);

  const [chatrooms, setChatrooms] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [messages, setMessages] = useState([]);

  const [newRoom, setNewRoom] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  const [messageText, setMessageText] = useState("");
  const [findMessage, setFindMessage] = useState("");
  const [editMessage, setEditMessage] = useState(null);
  const [editText, setEditText] = useState("");
  const [botTyping, setBotTyping] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);

  const [openReactionMessageId, setOpenReactionMessageId] = useState(null);
  const [openReactionSummaryId, setOpenReactionSummaryId] = useState(null);

  const bottomRef = useRef(null);
  const messageRefs = useRef({});
  const notifiedMessagesRef = useRef(new Set());
  const firstLoadRoomsRef = useRef(new Set());
  const currentRoomRef = useRef(null);

  const filteredMessages = useMemo(() => {
    const search = findMessage.trim().toLowerCase();

    if (!search) return messages;

    return messages.filter(message =>
      (message.text || "").toLowerCase().includes(search)
    );
  }, [messages, findMessage]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setCurrentRoom(null);
        setMessages([]);
        return;
      }

      await loadProfile(currentUser.uid);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const roomsQuery = query(
      collection(db, "chatrooms"),
      where("members", "array-contains", user.uid)
    );

    return onSnapshot(roomsQuery, snapshot => {
      const rooms = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      setChatrooms(rooms);
    });
  }, [user]);

  useEffect(() => {
    if (!user) return undefined;

    const unsubscribers = chatrooms.map(room => {
      const messagesQuery = query(
        getMessageHistory(room.id),
        orderBy("createdAt", "asc")
      );

      return onSnapshot(messagesQuery, snapshot => {
        if (!firstLoadRoomsRef.current.has(room.id)) {
          snapshot.docs.forEach(docSnap => {
            notifiedMessagesRef.current.add(docSnap.id);
          });

          firstLoadRoomsRef.current.add(room.id);
          return;
        }

        snapshot.docChanges().forEach(change => {
          if (change.type !== "added") return;

          const message = change.doc.data();
          const messageId = change.doc.id;

          if (notifiedMessagesRef.current.has(messageId)) return;

          notifiedMessagesRef.current.add(messageId);

          const isMine = message.senderId === user.uid;
          const isCurrentRoom = currentRoomRef.current?.id === room.id;

          if (!isMine && !isCurrentRoom) {
            showMessageNotification(room, message);
          }
        });
      });
    });

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [user, chatrooms]);

  useEffect(() => {
    if (!currentRoom) return undefined;

    const messagesQuery = query(
      getMessageHistory(currentRoom.id),
      orderBy("createdAt", "asc")
    );

    return onSnapshot(messagesQuery, snapshot => {
      const messageList = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      setMessages(messageList);
    });
  }, [currentRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, botTyping]);

  useEffect(() => {
    messageRefs.current = {};
  }, [currentRoom?.id]);

  function showMessageNotification(room, message) {
    if (Notification.permission !== "granted") return;

    new Notification(`New message in ${room.name}`, {
      body:
        message.type === "image"
          ? `${getSender(message)} sent an image`
          : `${getSender(message)}: ${message.text}`
    });
  }

  function showTestNotification() {
    new Notification("Notifications enabled", {
      body: "You will be notified when you receive unread messages."
    });
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      alert("This browser does not support notifications.");
      return;
    }

    if (Notification.permission === "granted") {
      showTestNotification();
      return;
    }

    if (Notification.permission === "denied") {
      alert("Notifications are blocked. Please enable them in Chrome site settings.");
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission === "granted") {
      showTestNotification();
    } else {
      alert("Notification permission was not granted.");
    }
  }

  async function loadProfile(uid) {
    const profileSnap = await getDoc(doc(db, "users", uid));

    if (profileSnap.exists()) {
      setProfile(profileSnap.data());
    }
  }

  async function handleSignup(event) {
    event.preventDefault();

    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const newProfile = buildUserProfile(result.user);

      await setDoc(doc(db, "users", result.user.uid), newProfile);

      setProfile(newProfile);
      clearAuthForm();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();

    try {
      await signInWithEmailAndPassword(auth, email, password);
      clearAuthForm();
    } catch (error) {
      alert(error.message);
    }
  }

  async function handleGoogleLogin() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const googleUser = result.user;

      const userRef = doc(db, "users", googleUser.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        setProfile(userSnap.data());
        return;
      }

      const newProfile = buildUserProfile(googleUser);

      await setDoc(userRef, newProfile);
      setProfile(newProfile);
    } catch (error) {
      console.error(error);

      if (error.code === "auth/popup-closed-by-user") {
        alert("Google sign-in was closed before finishing.");
      } else {
        alert(error.message);
      }
    }
  }

  async function handleLogout() {
    await signOut(auth);
    setCurrentRoom(null);
    setMessages([]);
  }

  function clearAuthForm() {
    setEmail("");
    setPassword("");
  }

  async function saveProfile(updatedProfile) {
    await updateDoc(doc(db, "users", user.uid), updatedProfile);
    setProfile(updatedProfile);
    setShowProfile(false);
  }

  async function createRoom() {
    const roomName = newRoom.trim();

    if (!roomName) return;

    await addDoc(collection(db, "chatrooms"), {
      name: roomName,
      members: [user.uid],
      memberEmails: [user.email],
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });

    setNewRoom("");
  }

  async function inviteMember() {
    const emailToInvite = inviteEmail.trim();

    if (!currentRoom || !emailToInvite) return;

    const usersQuery = query(
      collection(db, "users"),
      where("email", "==", emailToInvite)
    );

    const snapshot = await getDocs(usersQuery);

    if (snapshot.empty) {
      alert("No registered user found with this email.");
      return;
    }

    const invitedUser = snapshot.docs[0].data();

    if (currentRoom.members.includes(invitedUser.uid)) {
      alert("This user is already in the chatroom.");
      return;
    }

    const updatedRoom = {
      ...currentRoom,
      members: [...currentRoom.members, invitedUser.uid],
      memberEmails: [...(currentRoom.memberEmails || []), invitedUser.email]
    };

    await updateDoc(doc(db, "chatrooms", currentRoom.id), {
      members: updatedRoom.members,
      memberEmails: updatedRoom.memberEmails
    });

    setCurrentRoom(updatedRoom);
    setInviteEmail("");
  }

  function startReply(message) {
    setReplyTo(getReplyPreview(message));
  }

  function scrollToOriginalMessage(messageId) {
    const target = messageRefs.current[messageId];

    if (!target) return;

    target.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });

    setHighlightedMessageId(messageId);

    setTimeout(() => {
      setHighlightedMessageId(null);
    }, 1200);
  }

  async function toggleEmoji(message, emoji) {
    if (!currentRoom || !user) return;

    const messageRef = doc(
      db,
      "chatrooms",
      currentRoom.id,
      "messages",
      message.id
    );

    const currentReactions = message.reactions || {};
    const existingEmoji = Object.entries(currentReactions).find(([, users]) =>
      users.includes(user.uid)
    )?.[0];

    if (existingEmoji && existingEmoji !== emoji) {
      alert("You already reacted to this message. Remove your current emoji first.");
      return;
    }

    const updatedReactions = Object.entries(currentReactions).reduce(
      (reactions, [reactionEmoji, users]) => {
        let updatedUsers = users;

        if (reactionEmoji === emoji) {
          updatedUsers = users.includes(user.uid)
            ? users.filter(uid => uid !== user.uid)
            : [...users, user.uid];
        }

        if (updatedUsers.length > 0) {
          reactions[reactionEmoji] = updatedUsers;
        }

        return reactions;
      },
      {}
    );

    if (!currentReactions[emoji] && !existingEmoji) {
      updatedReactions[emoji] = [user.uid];
    }

    await updateDoc(messageRef, { reactions: updatedReactions });
  }

  async function sendMessage() {
    const textToSend = messageText.trim();

    if (!currentRoom || !user || textToSend === "") return;

    const selectedReply = replyTo;

    setMessageText("");
    setReplyTo(null);

    await addTextMessage(textToSend, selectedReply);

    if (shouldTriggerBot(textToSend)) {
      await sendBotMessage(textToSend);
    }
  }

  async function addTextMessage(text, selectedReply) {
    await addDoc(getMessageHistory(currentRoom.id), {
      text,
      senderId: user.uid,
      senderEmail: user.email,
      senderName: profile?.username || user.email,
      senderPhoto: profile?.profilePicture || "",
      type: "text",
      replyTo: selectedReply,
      reactions: {},
      createdAt: serverTimestamp(),
      edited: false
    });
  }

  function shouldTriggerBot(text) {
    return (
      text.toLowerCase().startsWith("@bot") ||
      currentRoom.name.toLowerCase().includes("bot")
    );
  }

  async function sendBotMessage(text) {
    const prompt = text.replace(/^@bot/i, "").trim();

    if (!prompt) return;

    setBotTyping(true);

    const botReply = await getBotReply(prompt);

    setBotTyping(false);

    await addDoc(getMessageHistory(currentRoom.id), {
      text: botReply,
      senderId: BOT_ID,
      senderEmail: BOT_EMAIL,
      senderName: BOT_NAME,
      senderPhoto: "",
      type: "text",
      replyTo: null,
      reactions: {},
      createdAt: serverTimestamp(),
      edited: false
    });
  }

  async function getBotReply(userText) {
    try {
      const ai = new GoogleGenAI({
        apiKey: process.env.REACT_APP_GEMINI_API_KEY
      });

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: userText
      });

      return response.text || "Sorry, I could not answer that.";
    } catch (error) {
      console.error(error);
      return "Sorry, the chatbot is not available right now.";
    }
  }

  function resizeImage(file, maxWidth = 700, quality = 0.65) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = event => {
        const image = new Image();

        image.onload = () => {
          const canvas = document.createElement("canvas");
          const scale = image.width > maxWidth ? maxWidth / image.width : 1;
          const width = image.width * scale;
          const height = image.height * scale;

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, width, height);

          resolve(canvas.toDataURL("image/jpeg", quality));
        };

        image.onerror = reject;
        image.src = event.target.result;
      };

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function sendImage(event) {
    const file = event.target.files[0];

    if (!file || !currentRoom || !user) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      event.target.value = "";
      return;
    }

    try {
      const compressedImage = await resizeImage(file);
      const selectedReply = replyTo;

      setReplyTo(null);

      await addDoc(getMessageHistory(currentRoom.id), {
        image: compressedImage,
        senderId: user.uid,
        senderEmail: user.email,
        senderName: profile?.username || user.email,
        senderPhoto: profile?.profilePicture || "",
        type: "image",
        replyTo: selectedReply,
        reactions: {},
        createdAt: serverTimestamp(),
        edited: false
      });

      event.target.value = "";
    } catch (error) {
      console.error(error);
      alert("Image upload failed. Please try a smaller image.");
    }
  }

  async function unsendMessage(messageId, senderId) {
    if (senderId !== user.uid) {
      alert("You can only unsend your own message.");
      return;
    }

    await deleteDoc(doc(db, "chatrooms", currentRoom.id, "messages", messageId));
  }

  function startEdit(message) {
    if (message.senderId !== user.uid) {
      alert("You can only edit your own message.");
      return;
    }

    setEditMessage(message);
    setEditText(message.text || "");
  }

  async function saveEdit() {
    const updatedText = editText.trim();

    if (!editMessage || !updatedText) return;

    await updateDoc(
      doc(db, "chatrooms", currentRoom.id, "messages", editMessage.id),
      {
        text: updatedText,
        edited: true
      }
    );

    setEditMessage(null);
    setEditText("");
  }

  if (!user) {
    return (
      <AuthPage
        mode={mode}
        setMode={setMode}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        handleLogin={handleLogin}
        handleSignup={handleSignup}
        handleGoogleLogin={handleGoogleLogin}
      />
    );
  }

  return (
    <div className="app">
      <Sidebar
        user={user}
        profile={profile}
        chatrooms={chatrooms}
        currentRoom={currentRoom}
        newRoom={newRoom}
        setNewRoom={setNewRoom}
        setCurrentRoom={setCurrentRoom}
        createRoom={createRoom}
        handleLogout={handleLogout}
        requestNotificationPermission={requestNotificationPermission}
        openProfile={() => setShowProfile(true)}
      />

      <main className="chat-area">
        {!currentRoom ? (
          <div className="empty-chat">
            <h2>Select or create a chatroom</h2>
          </div>
        ) : (
          <>
            <ChatHeader
              currentRoom={currentRoom}
              inviteEmail={inviteEmail}
              setInviteEmail={setInviteEmail}
              inviteMember={inviteMember}
            />

            <div className="search-box">
              <input
                placeholder="Search messages..."
                value={findMessage}
                onChange={event => setFindMessage(event.target.value)}
              />
            </div>

            <MessageList
              user={user}
              messages={filteredMessages}
              botTyping={botTyping}
              bottomRef={bottomRef}
              messageRefs={messageRefs}
              highlightedMessageId={highlightedMessageId}
              openReactionMessageId={openReactionMessageId}
              openReactionSummaryId={openReactionSummaryId}
              setOpenReactionMessageId={setOpenReactionMessageId}
              setOpenReactionSummaryId={setOpenReactionSummaryId}
              startReply={startReply}
              startEdit={startEdit}
              unsendMessage={unsendMessage}
              toggleEmoji={toggleEmoji}
              scrollToOriginalMessage={scrollToOriginalMessage}
            />

            {replyTo && (
              <ReplyPreviewInput
                replyTo={replyTo}
                clearReply={() => setReplyTo(null)}
              />
            )}

            <ChatInput
              messageText={messageText}
              setMessageText={setMessageText}
              sendMessage={sendMessage}
              sendImage={sendImage}
            />
          </>
        )}
      </main>

      {showProfile && (
        <ProfileModal
          profile={profile}
          onClose={() => setShowProfile(false)}
          onSave={saveProfile}
        />
      )}

      {editMessage && (
        <EditMessageModal
          editText={editText}
          setEditText={setEditText}
          saveEdit={saveEdit}
          close={() => setEditMessage(null)}
        />
      )}
    </div>
  );
}

function AuthPage({
  mode,
  setMode,
  email,
  setEmail,
  password,
  setPassword,
  handleLogin,
  handleSignup,
  handleGoogleLogin
}) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Chatroom</h1>

        <div className="tab-row">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Sign In
          </button>

          <button
            className={mode === "signup" ? "active" : ""}
            onClick={() => setMode("signup")}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={mode === "login" ? handleLogin : handleSignup}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            required
          />

          <button type="submit">
            {mode === "login" ? "Sign In" : "Create Account"}
          </button>

          <button type="button" onClick={handleGoogleLogin}>
            Continue with Google
          </button>
        </form>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  profile,
  chatrooms,
  currentRoom,
  newRoom,
  setNewRoom,
  setCurrentRoom,
  createRoom,
  handleLogout,
  requestNotificationPermission,
  openProfile
}) {
  return (
    <aside className="sidebar">
      <div className="user-box">
        {profile?.profilePicture ? (
          <img src={profile.profilePicture} alt="profile" />
        ) : (
          <div className="avatar">{user.email[0].toUpperCase()}</div>
        )}

        <div>
          <strong>{profile?.username || user.email}</strong>
          <p>{user.email}</p>
        </div>
      </div>

      <button onClick={openProfile}>Edit Profile</button>
      <button onClick={handleLogout}>Logout</button>
      <button onClick={requestNotificationPermission}>
        Enable Notifications
      </button>

      <hr />

      <h2>Chatrooms</h2>

      <div className="create-room">
        <input
          placeholder="New room name"
          value={newRoom}
          onChange={event => setNewRoom(event.target.value)}
        />
        <button onClick={createRoom}>Create</button>
      </div>

      <div className="room-list">
        {chatrooms.map(room => (
          <button
            key={room.id}
            className={currentRoom?.id === room.id ? "room active-room" : "room"}
            onClick={() => setCurrentRoom(room)}
          >
            {room.name}
          </button>
        ))}
      </div>
    </aside>
  );
}

function ChatHeader({ currentRoom, inviteEmail, setInviteEmail, inviteMember }) {
  return (
    <header className="chat-header">
      <div>
        <h2>{currentRoom.name}</h2>
        <p>{currentRoom.memberEmails?.join(", ")}</p>
      </div>

      <div className="invite-box">
        <input
          placeholder="Invite by email"
          value={inviteEmail}
          onChange={event => setInviteEmail(event.target.value)}
        />
        <button onClick={inviteMember}>Invite</button>
      </div>
    </header>
  );
}

function MessageList({
  user,
  messages,
  botTyping,
  bottomRef,
  messageRefs,
  highlightedMessageId,
  openReactionMessageId,
  openReactionSummaryId,
  setOpenReactionMessageId,
  setOpenReactionSummaryId,
  startReply,
  startEdit,
  unsendMessage,
  toggleEmoji,
  scrollToOriginalMessage
}) {
  return (
    <div className="message-list">
      {messages.map(message => (
        <MessageRow
          key={message.id}
          user={user}
          message={message}
          messageRefs={messageRefs}
          highlightedMessageId={highlightedMessageId}
          openReactionMessageId={openReactionMessageId}
          openReactionSummaryId={openReactionSummaryId}
          setOpenReactionMessageId={setOpenReactionMessageId}
          setOpenReactionSummaryId={setOpenReactionSummaryId}
          startReply={startReply}
          startEdit={startEdit}
          unsendMessage={unsendMessage}
          toggleEmoji={toggleEmoji}
          scrollToOriginalMessage={scrollToOriginalMessage}
        />
      ))}

      {botTyping && (
        <div className="bot-typing-row">
          <span className="typing-text">Gemini Bot is typing</span>
          <span className="dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      )}

      <div ref={bottomRef}></div>
    </div>
  );
}

function MessageRow({
  user,
  message,
  messageRefs,
  highlightedMessageId,
  openReactionMessageId,
  openReactionSummaryId,
  setOpenReactionMessageId,
  setOpenReactionSummaryId,
  startReply,
  startEdit,
  unsendMessage,
  toggleEmoji,
  scrollToOriginalMessage
}) {
  const isMine = message.senderId === user.uid;
  const senderInitial = getSender(message).charAt(0).toUpperCase();

  return (
    <div
      ref={element => {
        if (element) {
          messageRefs.current[message.id] = element;
        }
      }}
      className={`${isMine ? "message-row mine" : "message-row"} ${
        highlightedMessageId === message.id ? "highlight-message" : ""
      }`}
    >
      {!isMine && (
        <div className="sender-avatar">
          {message.senderPhoto ? (
            <img src={message.senderPhoto} alt="sender" />
          ) : (
            <div className="small-avatar">{senderInitial}</div>
          )}
        </div>
      )}

      <div className="message-bubble">
        {!isMine && (
          <div className="message-sender">
            <span>{getSender(message)}</span>
          </div>
        )}

        {message.replyTo && (
          <div
            className="reply-preview-in-message"
            onClick={() => scrollToOriginalMessage(message.replyTo.id)}
          >
            <strong>{message.replyTo.senderName}</strong>
            <span>{message.replyTo.text}</span>
          </div>
        )}

        {message.type === "image" ? (
          <img className="sent-image" src={message.image} alt="sent" />
        ) : (
          <p>{message.text}</p>
        )}

        <ReactionSummary
          message={message}
          openReactionSummaryId={openReactionSummaryId}
          setOpenReactionSummaryId={setOpenReactionSummaryId}
        />

        {message.edited && <small>edited</small>}

        <div className="message-actions">
          <button onClick={() => startReply(message)}>Reply</button>

          {isMine && message.type === "text" && (
            <button onClick={() => startEdit(message)}>Edit</button>
          )}

          {isMine && (
            <button onClick={() => unsendMessage(message.id, message.senderId)}>
              Unsend
            </button>
          )}
        </div>
      </div>

      <ReactionPicker
        message={message}
        openReactionMessageId={openReactionMessageId}
        setOpenReactionMessageId={setOpenReactionMessageId}
        toggleEmoji={toggleEmoji}
      />
    </div>
  );
}

function ReactionSummary({
  message,
  openReactionSummaryId,
  setOpenReactionSummaryId
}) {
  const entries = Object.entries(message.reactions || {}).filter(
    ([, users]) => users.length > 0
  );

  const maxVisible = 1;
  const visibleEntries = entries.slice(0, maxVisible);
  const extraCount = entries.length - maxVisible;

  if (entries.length === 0) return null;

  return (
    <div
      className={`reaction-display ${
        entries.length >= 2 ? "many-reactions" : ""
      }`}
    >
      {visibleEntries.map(([emoji, users]) => (
        <span key={emoji}>
          {emoji} {users.length}
        </span>
      ))}

      {extraCount > 0 && (
        <div className="more-reactions-wrapper">
          <button
            type="button"
            className="more-reactions"
            onClick={() =>
              setOpenReactionSummaryId(
                openReactionSummaryId === message.id ? null : message.id
              )
            }
          >
            +{extraCount}
          </button>

          {openReactionSummaryId === message.id && (
            <div className="reaction-popup">
              {entries.map(([emoji, users]) => (
                <div key={emoji}>
                  <span>{emoji}</span>
                  <strong>{users.length}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReactionPicker({
  message,
  openReactionMessageId,
  setOpenReactionMessageId,
  toggleEmoji
}) {
  return (
    <div className="reaction-wrapper">
      <button
        type="button"
        className="reaction-trigger"
        onClick={() =>
          setOpenReactionMessageId(
            openReactionMessageId === message.id ? null : message.id
          )
        }
      >
        😊
      </button>

      {openReactionMessageId === message.id && (
        <div className="emoji-bar facebook-style">
          {EMOJI_OPTIONS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                toggleEmoji(message, emoji);
                setOpenReactionMessageId(null);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplyPreviewInput({ replyTo, clearReply }) {
  return (
    <div className="reply-preview-input">
      <div>
        <strong>Replying to {replyTo.senderName}</strong>
        <p>{replyTo.text}</p>
      </div>

      <button type="button" onClick={clearReply}>
        X
      </button>
    </div>
  );
}

function ChatInput({ messageText, setMessageText, sendMessage, sendImage }) {
  return (
    <footer className="chat-input">
      <input type="file" accept="image/*" onChange={sendImage} />

      <input
        placeholder="Type a message..."
        value={messageText}
        onChange={event => setMessageText(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Enter") sendMessage();
        }}
      />

      <button type="button" onClick={sendMessage}>
        Send
      </button>
    </footer>
  );
}

function EditMessageModal({ editText, setEditText, saveEdit, close }) {
  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>Edit Message</h2>

        <textarea
          value={editText}
          onChange={event => setEditText(event.target.value)}
        />

        <div className="modal-buttons">
          <button onClick={saveEdit}>Save</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ProfileModal({ profile, onClose, onSave }) {
  const [username, setUsername] = useState(profile?.username || "");
  const [email, setEmail] = useState(profile?.email || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [address, setAddress] = useState(profile?.address || "");
  const [profilePicture, setProfilePicture] = useState(
    profile?.profilePicture || ""
  );

  function handleImage(event) {
    const file = event.target.files[0];

    if (!file) return;

    const reader = new FileReader();

    reader.onload = loadEvent => {
      setProfilePicture(loadEvent.target.result);
    };

    reader.readAsDataURL(file);
  }

  function handleSave() {
    onSave({
      ...profile,
      username,
      email,
      phone,
      address,
      profilePicture
    });
  }

  return (
    <div className="modal-bg">
      <div className="modal">
        <h2>User Profile</h2>

        {profilePicture && (
          <img className="profile-preview" src={profilePicture} alt="profile" />
        )}

        <input type="file" accept="image/*" onChange={handleImage} />

        <input
          placeholder="Username"
          value={username}
          onChange={event => setUsername(event.target.value)}
        />

        <input
          placeholder="Email"
          value={email}
          onChange={event => setEmail(event.target.value)}
        />

        <input
          placeholder="Phone number"
          value={phone}
          onChange={event => setPhone(event.target.value)}
        />

        <input
          placeholder="Address"
          value={address}
          onChange={event => setAddress(event.target.value)}
        />

        <div className="modal-buttons">
          <button onClick={handleSave}>Save</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default App;