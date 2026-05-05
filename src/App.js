import React, { useEffect, useState, useRef } from "react";
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
  const [findMessage, setfindMessage] = useState("");

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

  const emojiOptions = ["❤️", "😂", "😮", "😭", "😡", "👍"];

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      setUser(currentUser);

      if (currentUser) {
        await loadProfile(currentUser.uid);
      } else {
        setProfile(null);
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, "chatrooms"),
      where("members", "array-contains", user.uid)
    );

    const unsubscribe = onSnapshot(q, snapshot => {
      const rooms = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      setChatrooms(rooms);
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const unsubscribers = [];

    chatrooms.forEach(room => {
      const q = query(
        collection(db, "chatrooms", room.id, "messages"),
        orderBy("createdAt", "asc")
      );

      const unsubscribe = onSnapshot(q, snapshot => {
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

          if (!isMine && !isCurrentRoom && Notification.permission === "granted") {
            new Notification(`New message in ${room.name}`, {
              body:
                message.type === "image"
                  ? `${message.senderName || message.senderEmail} sent an image`
                  : `${message.senderName || message.senderEmail}: ${message.text}`
            });
          }
        });
      });

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [user, chatrooms]);

  useEffect(() => {
    if (!currentRoom) return;

    const q = query(
      collection(db, "chatrooms", currentRoom.id, "messages"),
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, snapshot => {
      const msgList = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));

      setMessages(msgList);
    });

    return () => unsubscribe();
  }, [currentRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, botTyping]);

  function showTestNotification() {
    new Notification("Notifications enabled", {
      body: "You will be notified when you receive unread messages."
    });
  }

  function requestNotificationPermission() {
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

    Notification.requestPermission().then(permission => {
      if (permission === "granted") {
        showTestNotification();
      } else {
        alert("Notification permission was not granted.");
      }
    });
  }

  async function loadProfile(uid) {
    const profileRef = doc(db, "users", uid);
    const profileSnap = await getDoc(profileRef);

    if (profileSnap.exists()) {
      setProfile(profileSnap.data());
    }
  }

  async function handleSignup(e) {
    e.preventDefault();

    const result = await createUserWithEmailAndPassword(auth, email, password);

    const newProfile = {
      uid: result.user.uid,
      email: result.user.email,
      username: result.user.email.split("@")[0],
      phone: "",
      address: "",
      profilePicture: ""
    };

    await setDoc(doc(db, "users", result.user.uid), newProfile);

    setProfile(newProfile);
    setEmail("");
    setPassword("");
  }

  async function handleLogin(e) {
    e.preventDefault();

    await signInWithEmailAndPassword(auth, email, password);

    setEmail("");
    setPassword("");
  }

  async function handleGoogleLogin() {
    try {
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      const googleUser = result.user;

      const userRef = doc(db, "users", googleUser.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        const newProfile = {
          uid: googleUser.uid,
          email: googleUser.email,
          username: googleUser.displayName || googleUser.email.split("@")[0],
          phone: "",
          address: "",
          profilePicture: googleUser.photoURL || ""
        };

        await setDoc(userRef, newProfile);
        setProfile(newProfile);
      } else {
        setProfile(userSnap.data());
      }
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
  }

  async function saveProfile(updatedProfile) {
    await updateDoc(doc(db, "users", user.uid), updatedProfile);
    setProfile(updatedProfile);
    setShowProfile(false);
  }

  async function createRoom() {
    if (!newRoom.trim()) return;

    await addDoc(collection(db, "chatrooms"), {
      name: newRoom,
      members: [user.uid],
      memberEmails: [user.email],
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });

    setNewRoom("");
  }

  async function inviteMember() {
    if (!currentRoom || !inviteEmail.trim()) return;

    const q = query(
      collection(db, "users"),
      where("email", "==", inviteEmail.trim())
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      alert("No registered user found with this email.");
      return;
    }

    const invitedUser = snapshot.docs[0].data();

    if (currentRoom.members.includes(invitedUser.uid)) {
      alert("This user is already in the chatroom.");
      return;
    }

    const updatedMembers = [...currentRoom.members, invitedUser.uid];
    const updatedEmails = [...currentRoom.memberEmails, invitedUser.email];

    await updateDoc(doc(db, "chatrooms", currentRoom.id), {
      members: updatedMembers,
      memberEmails: updatedEmails
    });

    setCurrentRoom({
      ...currentRoom,
      members: updatedMembers,
      memberEmails: updatedEmails
    });

    setInviteEmail("");
  }

  function startReply(message) {
    setReplyTo({
      id: message.id,
      text: message.type === "image" ? "Image" : message.text,
      senderName: message.senderName || message.senderEmail
    });
  }

  function originalMessage(messageId) {
    const target = messageRefs.current[messageId];

    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      setHighlightedMessageId(messageId);

      setTimeout(() => {
        setHighlightedMessageId(null);
      }, 1200);
    }
  }

  async function toggleReaction(message, emoji) {
    if (!currentRoom || !user) return;

    const messageRef = doc(
      db,
      "chatrooms",
      currentRoom.id,
      "messages",
      message.id
    );

    const oldReactions = message.reactions || {};

    let userCurrentEmoji = null;

    Object.entries(oldReactions).forEach(([reactionEmoji, users]) => {
      if (users.includes(user.uid)) {
        userCurrentEmoji = reactionEmoji;
      }
    });

    if (userCurrentEmoji && userCurrentEmoji !== emoji) {
      alert("You already reacted to this message. Remove your current emoji first.");
      return;
    }

    const updatedReactions = {};

    Object.entries(oldReactions).forEach(([reactionEmoji, users]) => {
      let updatedUsers = users;

      if (reactionEmoji === emoji && users.includes(user.uid)) {
        updatedUsers = users.filter(uid => uid !== user.uid);
      } else if (reactionEmoji === emoji && !users.includes(user.uid)) {
        updatedUsers = [...users, user.uid];
      }

      if (updatedUsers.length > 0) {
        updatedReactions[reactionEmoji] = updatedUsers;
      }
    });

    if (!oldReactions[emoji] && !userCurrentEmoji) {
      updatedReactions[emoji] = [user.uid];
    }

    await updateDoc(messageRef, {
      reactions: updatedReactions
    });
  }

  async function sendMessage() {
    const textToSend = messageText.trim();

    if (!currentRoom || textToSend === "") return;

    const selectedReply = replyTo;

    setMessageText("");
    setReplyTo(null);

    await addDoc(collection(db, "chatrooms", currentRoom.id, "messages"), {
      text: textToSend,
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

    if (
      textToSend.toLowerCase().startsWith("@bot") ||
      currentRoom.name.toLowerCase().includes("bot")
    ) {
      const prompt = textToSend.replace(/^@bot/i, "").trim();

      if (prompt === "") return;

      setBotTyping(true);

      const botReply = await getBotReply(prompt);

      setBotTyping(false);

      await addDoc(collection(db, "chatrooms", currentRoom.id, "messages"), {
        text: botReply,
        senderId: "chatbot",
        senderEmail: "chatbot@gemini.ai",
        senderName: "Gemini Bot",
        senderPhoto: "",
        type: "text",
        replyTo: null,
        reactions: {},
        createdAt: serverTimestamp(),
        edited: false
      });
    }
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
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement("canvas");

          let width = img.width;
          let height = img.height;

          if (width > maxWidth) {
            height = (maxWidth / width) * height;
            width = maxWidth;
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedBase64);
        };

        img.onerror = reject;
        img.src = event.target.result;
      };

      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function sendImage(e) {
    const file = e.target.files[0];

    if (!file || !currentRoom) return;

    if (!file.type.startsWith("image/")) {
      alert("Please choose an image file.");
      return;
    }

    try {
      const compressedImage = await resizeImage(file);
      const selectedReply = replyTo;

      setReplyTo(null);

      await addDoc(collection(db, "chatrooms", currentRoom.id, "messages"), {
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

      e.target.value = "";
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
    if (!editMessage || !editText.trim()) return;

    await updateDoc(
      doc(db, "chatrooms", currentRoom.id, "messages", editMessage.id),
      {
        text: editText,
        edited: true
      }
    );

    setEditMessage(null);
    setEditText("");
  }

  const filteredMessages = messages.filter(message => {
    if (!findMessage.trim()) return true;

    return (
      message.text &&
      message.text.toLowerCase().includes(findMessage.toLowerCase())
    );
  });

  if (!user) {
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
              onChange={e => setEmail(e.target.value)}
              required
            />

            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
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

  return (
    <div className="app">
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

        <button onClick={() => setShowProfile(true)}>Edit Profile</button>
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
            onChange={e => setNewRoom(e.target.value)}
          />
          <button onClick={createRoom}>Create</button>
        </div>

        <div className="room-list">
          {chatrooms.map(room => (
            <button
              key={room.id}
              className={
                currentRoom?.id === room.id ? "room active-room" : "room"
              }
              onClick={() => setCurrentRoom(room)}
            >
              {room.name}
            </button>
          ))}
        </div>
      </aside>

      <main className="chat-area">
        {!currentRoom ? (
          <div className="empty-chat">
            <h2>Select or create a chatroom</h2>
          </div>
        ) : (
          <>
            <header className="chat-header">
              <div>
                <h2>{currentRoom.name}</h2>
                <p>{currentRoom.memberEmails?.join(", ")}</p>
              </div>

              <div className="invite-box">
                <input
                  placeholder="Invite by email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                />
                <button onClick={inviteMember}>Invite</button>
              </div>
            </header>

            <div className="search-box">
              <input
                placeholder="Search messages..."
                value={findMessage}
                onChange={e => setfindMessage(e.target.value)}
              />
            </div>

            <div className="message-list">
              {filteredMessages.map(message => {
                const isMine = message.senderId === user.uid;
                const senderInitial = (
                  message.senderName ||
                  message.senderEmail ||
                  "?"
                )
                  .charAt(0)
                  .toUpperCase();

                return (
                  <div
                    key={message.id}
                    ref={el => {
                      messageRefs.current[message.id] = el;
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
                          <span>
                            {message.senderName || message.senderEmail}
                          </span>
                        </div>
                      )}

                      {message.replyTo && (
                        <div
                          className="reply-preview-in-message"
                          onClick={() => originalMessage(message.replyTo.id)}
                        >
                          <strong>{message.replyTo.senderName}</strong>
                          <span>{message.replyTo.text}</span>
                        </div>
                      )}

                      {message.type === "image" ? (
                        <img
                          className="sent-image"
                          src={message.image}
                          alt="sent"
                        />
                      ) : (
                        <p>{message.text}</p>
                      )}

                      {message.reactions &&
                        (() => {
                          const entries = Object.entries(message.reactions).filter(
                            ([emoji, users]) => users.length > 0
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
                                        openReactionSummaryId === message.id
                                          ? null
                                          : message.id
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
                        })()}

                      {message.edited && <small>edited</small>}

                      <div className="message-actions">
                        <button onClick={() => startReply(message)}>
                          Reply
                        </button>

                        {isMine && message.type === "text" && (
                          <button onClick={() => startEdit(message)}>
                            Edit
                          </button>
                        )}

                        {isMine && (
                          <button
                            onClick={() =>
                              unsendMessage(message.id, message.senderId)
                            }
                          >
                            Unsend
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="reaction-wrapper">
                      <button
                        type="button"
                        className="reaction-trigger"
                        onClick={() =>
                          setOpenReactionMessageId(
                            openReactionMessageId === message.id
                              ? null
                              : message.id
                          )
                        }
                      >
                        😊
                      </button>

                      {openReactionMessageId === message.id && (
                        <div className="emoji-bar facebook-style">
                          {emojiOptions.map(emoji => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => {
                                toggleReaction(message, emoji);
                                setOpenReactionMessageId(null);
                              }}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

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

            {replyTo && (
              <div className="reply-preview-input">
                <div>
                  <strong>Replying to {replyTo.senderName}</strong>
                  <p>{replyTo.text}</p>
                </div>

                <button type="button" onClick={() => setReplyTo(null)}>
                  X
                </button>
              </div>
            )}

            <footer className="chat-input">
              <input type="file" accept="image/*" onChange={sendImage} />

              <input
                placeholder="Type a message..."
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") sendMessage();
                }}
              />

              <button type="button" onClick={sendMessage}>
                Send
              </button>
            </footer>
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
        <div className="modal-bg">
          <div className="modal">
            <h2>Edit Message</h2>

            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
            />

            <div className="modal-buttons">
              <button onClick={saveEdit}>Save</button>
              <button onClick={() => setEditMessage(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
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

  function handleImage(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = event => {
      setProfilePicture(event.target.result);
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
          onChange={e => setUsername(e.target.value)}
        />

        <input
          placeholder="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <input
          placeholder="Phone number"
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />

        <input
          placeholder="Address"
          value={address}
          onChange={e => setAddress(e.target.value)}
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