import React, { useState, useEffect, useRef } from 'react';
import { db, auth } from './firebase';
import { 
  signInAnonymously, 
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  updateDoc,
  deleteDoc,
  orderBy,
  serverTimestamp 
} from 'firebase/firestore';
import { chatWithPakMat, diagnoseWithImage } from './gemini';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './index.css';
import riceBg from './assets/rice-bg.png';

function App() {
  const [user, setUser] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState('local-session');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [usePersistence, setUsePersistence] = useState(false);
  const [activeModal, setActiveModal] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // Authentication
  useEffect(() => {
    signInAnonymously(auth)
      .then(() => setUsePersistence(true))
      .catch(err => {
        console.warn("Firebase Auth restricted or failed. Falling back to Local Mode.", err);
        setUsePersistence(false);
        // Initialize one local session if we don't have persistence
        setSessions([{ id: 'local-session', title: 'Local Session', messages: [], updatedAt: new Date() }]);
      });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUser(user);
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Sessions from Firestore
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'chats'), 
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedSessions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      if (fetchedSessions.length === 0 && !snapshot.metadata.fromCache) {
        // Only create if we are sure it's empty (not just cold start)
        createNewChat();
      } else {
        setSessions(fetchedSessions);
        if (fetchedSessions.length > 0 && !currentSessionId) {
          setCurrentSessionId(fetchedSessions[0].id);
        }
        // Auto-close history on item select (mobile)
        setIsHistoryOpen(false);
      }
      setLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [user]);

  const activeIndex = sessions.findIndex(s => s.id === currentSessionId);
  const messages = sessions[activeIndex]?.messages || [];

  const setMessages = (setter) => {
    setSessions(prev => {
      const idx = prev.findIndex(s => s.id === currentSessionId);
      if (idx === -1) return prev;
      const copy = [...prev];
      const newMessages = typeof setter === 'function' ? setter(copy[idx].messages) : setter;
      
      let newTitle = copy[idx].title;
      if (newTitle === 'New Chat' || newTitle === 'Initial Diagnosis') {
        const firstUserMessage = newMessages.find(m => m.role === 'user' && m.type === 'text');
        if (firstUserMessage) {
           newTitle = firstUserMessage.text.slice(0, 30) + (firstUserMessage.text.length > 30 ? '...' : '');
        }
      }
      
      copy[idx] = { ...copy[idx], messages: newMessages, title: newTitle };
      return copy;
    });
  };

  const createNewChat = async () => {
    const localId = 'local-' + Date.now();
    const newSession = {
      id: localId,
      title: 'New Chat',
      messages: [],
      updatedAt: new Date()
    };

    if (usePersistence && user) {
      try {
        const docRef = await addDoc(collection(db, 'chats'), {
          userId: user.uid,
          title: 'New Chat',
          messages: [],
          updatedAt: serverTimestamp()
        });
        setCurrentSessionId(docRef.id);
      } catch (err) {
        console.error("Error creating remote chat, using local:", err);
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(localId);
      }
    } else {
      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(localId);
    }
  };

  const deleteChatSession = async (e, id) => {
    e.stopPropagation(); 
    if (!window.confirm('Padam chat ni?')) return;

    if (usePersistence && id !== 'local-session' && !id.toString().startsWith('local-') && user) {
      try {
        await deleteDoc(doc(db, 'chats', id));
      } catch (err) {
        console.error("Error deleting remote chat:", err);
      }
    }
    
    setSessions(prev => prev.filter(s => s.id !== id));
    if (currentSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setCurrentSessionId(remaining.length > 0 ? remaining[0].id : 'local-session');
    }
  };
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [scanResult, setScanResult] = useState(null);
  const chatEndRef = useRef(null);
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  useEffect(() => {
    if (showCamera) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(err => {
          console.error("Camera error:", err);
          alert("Camera not accessible. Please check your browser permissions.");
          setShowCamera(false);
        });
    }
    return () => {
      if (!showCamera && streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [showCamera]);

  const startCamera = () => {
    setShowCamera(true);
  };

  const stopCamera = () => {
    setShowCamera(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0);
      
      canvas.toBlob((blob) => {
        const file = new File([blob], "camera-photo.jpg", { type: "image/jpeg" });
        setImage(file);
        setPreview({ type: 'image', url: URL.createObjectURL(file) });
        stopCamera();
      }, 'image/jpeg');
    }
  };

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage(file);
      if (file.type.startsWith('image/')) {
        setPreview({ type: 'image', url: URL.createObjectURL(file) });
      } else {
        setPreview({ type: 'document', name: file.name });
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() && !image) return;

    const userMessage = { role: 'user', text: input, type: image ? 'image' : 'text', imagePreview: preview, time: 'JUST NOW' };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      let response;
      if (image) {
        response = await diagnoseWithImage(image, input);
        
        // Intelligent Dashboard Sync: Parse AI response for status keywords
        const lowerRes = response.toLowerCase();
        const isSick = lowerRes.includes('sakit') || lowerRes.includes('penyakit') || lowerRes.includes('karang') || lowerRes.includes('blast') || lowerRes.includes('bintik');
        const isHealthy = lowerRes.includes('sihat') || lowerRes.includes('elok') || lowerRes.includes('subur');
        
        // Default to Sick if we found disease keywords, else follow AI hint
        const finalStatus = isSick ? 'Sick' : (isHealthy ? 'Healthy' : 'Monitor');
        const finalLabel = isSick ? 'Berpenyakit' : (isHealthy ? 'Sihat' : 'Perlu Pantau');

        setScanResult({
          statusLabel: finalLabel,
          status: finalStatus,
          variety: 'MR 219',
          date: 'Just now',
          alert: isSick ? 'Penyakit dikesan!' : null,
          field: 'Field 2'
        });

        setImage(null);
        setPreview(null);
      } else {
        const history = messages.map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        }));
        response = await chatWithPakMat(input, history);
      }

      const botMessage = { role: 'model', text: response, type: 'text', time: 'JUST NOW' };
      const updatedMessages = [...messages, userMessage, botMessage];
      
      // Update local state first
      setMessages(updatedMessages);

      // Update Firestore ONLY if persistence is working and we have a user
      if (usePersistence && currentSessionId !== 'local-session' && user) {
        try {
          const sessionRef = doc(db, 'chats', currentSessionId);
          let newTitle = sessions[activeIndex].title;
          if (newTitle === 'New Chat') {
              newTitle = input.slice(0, 30) + (input.length > 30 ? '...' : '');
          }

          await updateDoc(sessionRef, {
            messages: updatedMessages,
            title: newTitle,
            updatedAt: serverTimestamp()
          });
        } catch (fsErr) {
          console.error("Firestore Update Error:", fsErr);
        }
      }

    } catch (error) {
      console.error("Gemini Error:", error);
      const errorMessage = { role: 'model', text: "Error: " + (error.message || "Unknown"), type: 'text', time: 'JUST NOW' };
      const updatedMessages = [...messages, userMessage, errorMessage];
      setMessages(updatedMessages);

      if (usePersistence && currentSessionId !== 'local-session' && user) {
        try {
          const sessionRef = doc(db, 'chats', currentSessionId);
          await updateDoc(sessionRef, { messages: updatedMessages });
        } catch (fsErr) {
          console.error("Firestore Error Log:", fsErr);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="app-container">
        {/* Mobile Header */}
        <header className="mobile-header">
          <button className="mobile-btn" onClick={() => setIsSidebarOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>
          <div className="brand" style={{ margin: 0 }}>
            <h1 style={{ fontSize: '18px' }}>Padi & Plates</h1>
          </div>
          <button className="mobile-btn" onClick={() => setIsHistoryOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </button>
        </header>

        {/* Overlays for Mobile */}
        {(isSidebarOpen || isHistoryOpen) && (
          <div className="sidebar-overlay" onClick={() => { setIsSidebarOpen(false); setIsHistoryOpen(false); }}></div>
        )}

      {showCamera && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '24px', borderRadius: '24px', position: 'relative', width: '90%', maxWidth: '500px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <button onClick={stopCamera} style={{ position: 'absolute', top: '15px', right: '15px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '16px' }}>×</button>
            <h3 style={{ marginBottom: '20px', color: '#222' }}>Take a Picture</h3>
            <div style={{ width: '100%', backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', aspectRatio: '4/3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video ref={videoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }}></video>
            </div>
            <button onClick={capturePhoto} style={{ marginTop: '20px', width: '100%', padding: '14px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600', cursor: 'pointer', transition: 'transform 0.2s' }}>
              Capture Photo 📸
            </button>
          </div>
        </div>
      )}
      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <button className="mobile-close-btn" onClick={() => setIsSidebarOpen(false)}>×</button>
        <div className="brand" style={{ marginBottom: '30px' }}>
          <h1>Padi & Plates</h1>
          <p>The Culinary Minimalist</p>
        </div>
        
        <button className="new-chat-btn" onClick={createNewChat} style={{ marginBottom: '15px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          New Chat
        </button>

        <div className="history-list" style={{ marginBottom: '20px' }}>
          {sessions.map(session => (
            <div 
              key={session.id} 
              className={`history-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => setCurrentSessionId(session.id)}
            >
              <span className="history-item-title">{session.title}</span>
              <button className="delete-chat-btn" onClick={(e) => deleteChatSession(e, session.id)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
          <ul className="nav-menu" style={{ gap: '15px' }}>
            <li className="nav-item" onClick={() => { setActiveModal('health'); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
              </svg>
              Bendang Health
            </li>
            <li className="nav-item" onClick={() => { setActiveModal('prices'); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
              Harga Padi
            </li>
            <li className="nav-item" onClick={() => { setActiveModal('padipedia'); setIsSidebarOpen(false); }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
              Padipedia
            </li>
          </ul>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <div className="top-cards">
          <div className="card card-scan">
            <div className="card-scan-label">LAST SCAN</div>
            <div className="card-scan-title">
              {scanResult ? scanResult.statusLabel : 'Awaiting Scan'} 
              {scanResult && <span className={`pill ${scanResult.alert ? 'monitor' : 'healthy'}`}>{scanResult.status}</span>}
            </div>
            <div className="card-scan-detail">
              {scanResult ? `${scanResult.variety} \u00B7 ${scanResult.date}` : '- \u00B7 -'}
            </div>
          </div>
          
          <div className="card card-scan">
            <div className="card-scan-label">ACTIVE ALERT</div>
            <div className={`card-scan-title ${scanResult?.alert ? 'alert' : ''}`}>
              {scanResult?.alert || 'No active alerts'}
            </div>
            <div className="card-scan-detail">
              {scanResult?.alert ? (
                <><span className="pill monitor">Monitor</span> {scanResult.field}</>
              ) : (
                <span style={{ color: '#888' }}>-</span>
              )}
            </div>
          </div>
        </div>

        <div className="chat-area-container">
          <div className="chat-messages">
            {messages.map((msg, index) => (
               <div key={index} className={`message ${msg.role === 'user' ? 'user' : 'bot'}`}>
                 <div className={`avatar ${msg.role === 'user' ? 'avatar-user' : 'avatar-bot'}`}>
                  {msg.role === 'user' ? 'ME' : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                      <path d="M12 2v20"></path>
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                  )}
                 </div>
                 <div className="message-content">
                   <div className="bubble">
                     {msg.imagePreview && msg.imagePreview.type === 'image' && (
                       <img src={msg.imagePreview.url} alt="upload" style={{ width: '200px', borderRadius: '8px', marginBottom: '10px' }} />
                     )}
                     {msg.imagePreview && msg.imagePreview.type === 'document' && (
                       <div style={{ background: 'rgba(255,255,255,0.2)', padding: '12px 16px', borderRadius: '8px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid currentColor' }}>
                         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                           <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                           <polyline points="14 2 14 8 20 8"></polyline>
                         </svg>
                         <span style={{ fontSize: '13px', fontWeight: 'bold', maxWidth: '150px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.imagePreview.name}</span>
                       </div>
                     )}
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>
                       {msg.text}
                     </ReactMarkdown>
                   </div>
                   <span className="timestamp">{msg.role === 'user' ? 'YOU' : 'PADIAI'} • {msg.time}</span>
                 </div>
               </div>
            ))}
            {loading && (
              <div className="message bot">
                <div className="avatar avatar-bot">...</div>
                <div className="message-content">
                  <div className="bubble">Thinking...</div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>

        {preview && (
          <div style={{ position: 'absolute', bottom: '110px', left: '50%', transform: 'translateX(-50%)', background: 'white', padding: '10px', borderRadius: '12px', boxShadow: '0 5px 20px rgba(0,0,0,0.1)', zIndex: 10 }}>
            {preview.type === 'image' ? (
              <img src={preview.url} alt="preview" style={{ height: '80px', borderRadius: '8px' }} />
            ) : (
              <div style={{ height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 20px', background: '#f5f5f5', borderRadius: '8px', color: '#555', fontWeight: '600', border: '1px dashed #ccc' }}>
                📄 {preview.name}
              </div>
            )}
            <button onClick={() => {setImage(null); setPreview(null);}} style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#ff4444', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>×</button>
          </div>
        )}

        <div className="input-container">
          <div className="input-actions">
            <label style={{ cursor: 'pointer', display: 'flex' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <input type="file" accept="image/*" onChange={handleImageChange} style={{ display: 'none' }} />
            </label>
            <div onClick={startCamera} style={{ cursor: 'pointer', display: 'flex' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
            </div>
            <label style={{ cursor: 'pointer', display: 'flex' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <input type="file" accept="*/*" onChange={handleImageChange} style={{ display: 'none' }} />
            </label>
          </div>
          <input 
            type="text" 
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your message or ask about rice..."
          />
          <button className="send-btn" onClick={handleSend} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </div>
      </main>


    </div>

    {/* Premium Feature Modals */}
    {activeModal && (
      <div className="modal-overlay" onClick={() => setActiveModal(null)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setActiveModal(null)}>×</button>
          
          {activeModal === 'health' && (
            <div className="feature-view">
              <h2>🚜 Bendang Health Dashboard</h2>
              <p className="subtitle">Real-time monitoring for MADA Region, Kedah</p>
              
              <div className="stats-grid">
                <div className="stat-card">
                  <span className="stat-label">Weather Status</span>
                  <span className="stat-value">Cloudy ☁️</span>
                  <span className="stat-sub">High humidity (82%)</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Soil pH Level</span>
                  <span className="stat-value">6.2</span>
                  <span className="stat-sub">Optimal for growth</span>
                </div>
                <div className="stat-card warning">
                  <span className="stat-label">Nitrogen (N)</span>
                  <span className="stat-value">Low</span>
                  <span className="stat-sub">Top dressing recommended</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Est. Harvest</span>
                  <span className="stat-value">5.2 tons</span>
                  <span className="stat-sub">End of May 2026</span>
                </div>
              </div>
            </div>
          )}

          {activeModal === 'prices' && (
            <div className="feature-view">
              <h2>💰 Harga Padi Semasa</h2>
              <p className="subtitle">Malaysia Market Prices • Last updated: Today</p>
              
              <table className="price-table">
                <thead>
                  <tr>
                    <th>State/Region</th>
                    <th>Subsidized Price</th>
                    <th>Market Price</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Kedah (MADA)</td>
                    <td>RM 1,550 /ton</td>
                    <td>RM 1,820 /ton</td>
                  </tr>
                  <tr>
                    <td>Selangor (IADA)</td>
                    <td>RM 1,550 /ton</td>
                    <td>RM 1,845 /ton</td>
                  </tr>
                  <tr>
                    <td>Perak (Kerian)</td>
                    <td>RM 1,550 /ton</td>
                    <td>RM 1,790 /ton</td>
                  </tr>
                  <tr>
                    <td>Kelantan (KADA)</td>
                    <td>RM 1,550 /ton</td>
                    <td>RM 1,760 /ton</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeModal === 'padipedia' && (
            <div className="feature-view">
              <h2>📖 Padipedia</h2>
              <p className="subtitle">Official Seed Varieties in Malaysia</p>
              
              <div className="pedia-list">
                <div className="pedia-item">
                  <h3>MR 219 (Padi Perdana)</h3>
                  <p>Most popular variety in Malaysia. High yield and resistant to most blast diseases. Maturity: 105-110 days.</p>
                </div>
                <div className="pedia-item">
                  <h3>MR 269 (Sirkon)</h3>
                  <p>Known for its excellent grain quality and better resistance to drought. Popular in Selangor and Perak.</p>
                </div>
                <div className="pedia-item">
                  <h3>MR 297</h3>
                  <p>Recent variety focusing on high pest resistance (specifically Brown Plant Hopper). Fast growing.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )}
    </>
  );
}

export default App;
