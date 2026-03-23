/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  addDoc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  Timestamp,
  getDocFromServer,
  getDocs
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  DragDropContext, 
  Droppable, 
  Draggable, 
  DropResult 
} from '@hello-pangea/dnd';
import { 
  Plus, 
  LogOut, 
  Users, 
  Calendar, 
  ExternalLink, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  XCircle,
  Search,
  ChevronRight,
  Copy,
  Check,
  Settings,
  Database,
  UserPlus,
  Trash,
  LayoutGrid,
  Table as TableIcon,
  Info,
  HelpCircle,
  FileText,
  Send
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  familyId?: string;
  role?: 'student' | 'guardian';
}

interface Family {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Timestamp;
}

interface Scholarship {
  id: string;
  title: string;
  provider?: string;
  amount?: number;
  deadline?: Timestamp;
  status: 'intake' | 'not_applicable' | 'need_to_apply' | 'in_progress' | 'applied';
  url?: string;
  notes?: string;
  familyId: string;
  addedBy: string;
  createdAt: Timestamp;
  applicableStudents?: string[];
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [family, setFamily] = useState<Family | null>(null);
  const [familyMembers, setFamilyMembers] = useState<UserProfile[]>([]);
  const [scholarships, setScholarships] = useState<Scholarship[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'board'>('table');
  const [activePage, setActivePage] = useState<'dashboard' | 'scholarship-form'>('dashboard');
  const [editingScholarship, setEditingScholarship] = useState<Scholarship | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ title: string, message: string, onConfirm: () => void } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
          showToast("Firebase connection error. Check console.", "error");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Fetch or create profile
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
        } else {
          const newProfile: UserProfile = {
            uid: firebaseUser.uid,
            email: firebaseUser.email || '',
            displayName: firebaseUser.displayName || 'Anonymous',
            photoURL: firebaseUser.photoURL || '',
          };
          await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
        setFamily(null);
        setScholarships([]);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (profile?.familyId) {
      const unsubFamily = onSnapshot(doc(db, 'families', profile.familyId), (doc) => {
        if (doc.exists()) {
          setFamily({ id: doc.id, ...doc.data() } as Family);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, `families/${profile.familyId}`);
      });

      const q = query(collection(db, 'scholarships'), where('familyId', '==', profile.familyId));
      const unsubScholarships = onSnapshot(q, (snapshot) => {
        const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Scholarship));
        setScholarships(items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'scholarships');
      });

      const qMembers = query(collection(db, 'users'), where('familyId', '==', profile.familyId));
      const unsubMembers = onSnapshot(qMembers, (snapshot) => {
        setFamilyMembers(snapshot.docs.map(doc => doc.data() as UserProfile));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'users');
      });

      return () => {
        unsubFamily();
        unsubScholarships();
        unsubMembers();
      };
    }
  }, [profile?.familyId]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
      showToast("Login failed", "error");
    }
  };

  const handleLogout = () => signOut(auth);

  const createFamily = async (name: string) => {
    if (!user) return;
    try {
      const familyRef = await addDoc(collection(db, 'families'), {
        name,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', user.uid), {
        familyId: familyRef.id,
        role: 'guardian'
      });
      setProfile(prev => prev ? { ...prev, familyId: familyRef.id, role: 'guardian' } : null);
      showToast("Family created!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'families/users');
    }
  };

  const joinFamily = async (familyId: string) => {
    if (!user) return;
    try {
      const familyDoc = await getDoc(doc(db, 'families', familyId));
      if (familyDoc.exists()) {
        await updateDoc(doc(db, 'users', user.uid), {
          familyId: familyId,
          role: 'student'
        });
        setProfile(prev => prev ? { ...prev, familyId: familyId, role: 'student' } : null);
        showToast("Joined family!");
      } else {
        showToast("Family not found!", "error");
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'users');
    }
  };

  const onDragEnd = async (result: DropResult) => {
    if (!result.destination) return;
    const { draggableId, destination } = result;
    const newStatus = destination.droppableId as Scholarship['status'];
    
    try {
      await updateDoc(doc(db, 'scholarships', draggableId), {
        status: newStatus,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `scholarships/${draggableId}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-light flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <div className="w-20 h-20 bg-brand rounded-3xl flex items-center justify-center shadow-xl shadow-brand/20 overflow-hidden">
            <img src="/Forage.png" className="w-12 h-12 object-contain" alt="Forage Logo" referrerPolicy="no-referrer" />
          </div>
          <p className="font-serif text-brand font-bold">Gathering your future...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage onLogin={handleLogin} />;
  }

  if (!profile?.familyId) {
    return <FamilySetup onCreate={createFamily} onJoin={joinFamily} />;
  }

  return (
    <div className="min-h-screen bg-brand-light text-[#1a1a1a] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-brand/10 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand rounded-xl flex items-center justify-center shadow-sm overflow-hidden">
              <img src="/Forage.png" className="w-6 h-6 object-contain" alt="Forage Logo" referrerPolicy="no-referrer" />
            </div>
            <h1 className="text-2xl font-serif font-bold text-brand tracking-tight">Forage</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center overflow-hidden border border-brand/10">
              <img 
                src={profile.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.displayName)}&background=random`} 
                alt={profile.displayName}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <button 
              onClick={() => setShowSettingsModal(true)}
              className="p-2 hover:bg-brand-light rounded-full transition-colors text-brand/60 hover:text-brand"
              title="Settings & Demo Data"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-brand-light rounded-full transition-colors text-brand/60 hover:text-brand"
              title="Logout"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {activePage === 'dashboard' ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                <h2 className="text-3xl font-serif text-[#1a1a1a]">Scholarships</h2>
                <div className="flex bg-brand-light p-1 rounded-xl border border-brand/10">
                  <button 
                    onClick={() => setViewMode('table')}
                    className={cn(
                      "p-2 rounded-lg transition-all flex items-center gap-2 text-sm font-bold",
                      viewMode === 'table' ? "bg-white text-brand shadow-sm" : "text-brand/40 hover:text-brand"
                    )}
                  >
                    <TableIcon className="w-4 h-4" />
                    <span>Table</span>
                  </button>
                  <button 
                    onClick={() => setViewMode('board')}
                    className={cn(
                      "p-2 rounded-lg transition-all flex items-center gap-2 text-sm font-bold",
                      viewMode === 'board' ? "bg-white text-brand shadow-sm" : "text-brand/40 hover:text-brand"
                    )}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span>Board</span>
                  </button>
                </div>
              </div>
              <button 
                onClick={() => {
                  setEditingScholarship(null);
                  setActivePage('scholarship-form');
                }}
                className="bg-brand text-white px-4 sm:px-6 py-2 rounded-full flex items-center gap-2 hover:bg-brand-dark transition-all shadow-lg shadow-brand/20 font-bold"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden sm:inline">Add New</span>
              </button>
            </div>

            {viewMode === 'table' ? (
              <div className="bg-white rounded-[32px] overflow-hidden border border-brand/10 shadow-sm">
                {scholarships?.length === 0 ? (
                  <div className="p-12 text-center">
                    <img src="/Forage.png" className="w-16 h-16 mx-auto mb-4 opacity-20 grayscale" alt="No scholarships" referrerPolicy="no-referrer" />
                    <p className="text-brand/60 italic">No scholarships recorded yet. Start foraging!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-brand-light/50 border-b border-brand/10">
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-brand/60">Scholarship</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-brand/60">Amount</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-brand/60">Deadline</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-brand/60">Students</th>
                          <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-brand/60">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scholarships?.map((s) => (
                          <ScholarshipRow 
                            key={s.id} 
                            scholarship={s} 
                            onEdit={() => {
                              setEditingScholarship(s);
                              setActivePage('scholarship-form');
                            }}
                            setConfirmModal={setConfirmModal}
                            showToast={showToast}
                            familyMembers={familyMembers}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <DragDropContext onDragEnd={onDragEnd}>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 h-[calc(100vh-250px)] min-h-[600px]">
                  <BoardColumn 
                    id="intake" 
                    title="Intake" 
                    scholarships={scholarships.filter(s => s.status === 'intake')} 
                    onEdit={(s) => { 
                      setEditingScholarship(s); 
                      setActivePage('scholarship-form'); 
                    }}
                    familyMembers={familyMembers}
                  />
                  <BoardColumn 
                    id="not_applicable" 
                    title="Not Applicable" 
                    scholarships={scholarships.filter(s => s.status === 'not_applicable')} 
                    onEdit={(s) => { 
                      setEditingScholarship(s); 
                      setActivePage('scholarship-form'); 
                    }}
                    familyMembers={familyMembers}
                  />
                  <BoardColumn 
                    id="need_to_apply" 
                    title="Need to Apply" 
                    scholarships={scholarships.filter(s => s.status === 'need_to_apply')} 
                    onEdit={(s) => { 
                      setEditingScholarship(s); 
                      setActivePage('scholarship-form'); 
                    }}
                    familyMembers={familyMembers}
                  />
                  <BoardColumn 
                    id="in_progress" 
                    title="In Progress" 
                    scholarships={scholarships.filter(s => s.status === 'in_progress')} 
                    onEdit={(s) => { 
                      setEditingScholarship(s); 
                      setActivePage('scholarship-form'); 
                    }}
                    familyMembers={familyMembers}
                  />
                  <BoardColumn 
                    id="applied" 
                    title="Applied" 
                    scholarships={scholarships.filter(s => s.status === 'applied')} 
                    onEdit={(s) => { 
                      setEditingScholarship(s); 
                      setActivePage('scholarship-form'); 
                    }}
                    familyMembers={familyMembers}
                  />
                </div>
              </DragDropContext>
            )}
          </div>
        ) : (
          <ScholarshipForm 
            onClose={() => {
              setActivePage('dashboard');
              setEditingScholarship(null);
            }}
            familyId={profile.familyId!}
            userId={user.uid}
            editing={editingScholarship}
            showToast={showToast}
            setConfirmModal={setConfirmModal}
            familyMembers={familyMembers}
          />
        )}
      </main>

      {/* Modals */}
      <AnimatePresence>
        {showSettingsModal && (
          <SettingsModal 
            onClose={() => setShowSettingsModal(false)}
            familyId={profile.familyId!}
            userId={user.uid}
            family={family}
            profile={profile}
            scholarships={scholarships}
            showToast={showToast}
            setConfirmModal={setConfirmModal}
          />
        )}
        {confirmModal && (
          <ConfirmModal 
            title={confirmModal.title}
            message={confirmModal.message}
            onConfirm={confirmModal.onConfirm}
            onCancel={() => setConfirmModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Subcomponents ---

function ConfirmModal({ title, message, onConfirm, onCancel }: { title: string, message: string, onConfirm: () => void, onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#1a1a1a]/60 backdrop-blur-md">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-[40px] w-full max-w-md overflow-hidden shadow-2xl border border-brand/10"
      >
        <div className="p-10 text-center space-y-6">
          <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-10 h-10 text-red-500" />
          </div>
          <div>
            <h2 className="text-3xl font-serif text-brand font-bold">{title}</h2>
            <p className="text-brand/60 font-serif mt-4 leading-relaxed">{message}</p>
          </div>
          <div className="flex gap-4 pt-4">
            <button 
              onClick={onCancel}
              className="flex-1 py-5 rounded-2xl bg-brand-light text-brand font-bold hover:bg-brand/10 transition-all"
            >
              Cancel
            </button>
            <button 
              onClick={onConfirm}
              className="flex-1 py-5 rounded-2xl bg-red-500 text-white font-bold hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
            >
              Delete
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LandingPage({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="min-h-screen bg-brand-light flex flex-col items-center justify-center p-4 text-center">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl"
      >
        <div className="w-32 h-32 bg-brand rounded-[40px] flex items-center justify-center mx-auto mb-10 shadow-2xl shadow-brand/30 overflow-hidden ring-4 ring-white/20">
          <img src="/Forage.png" className="w-16 h-16 object-contain" alt="Forage Logo" referrerPolicy="no-referrer" />
        </div>
        <h1 className="text-7xl font-serif font-bold text-brand mb-6 tracking-tight">Forage</h1>
        <p className="text-2xl text-brand/70 mb-12 font-serif max-w-lg mx-auto leading-relaxed">
          A collaborative space for families to gather, track, and secure their educational future.
        </p>
        <button 
          onClick={onLogin}
          className="bg-brand text-white px-12 py-5 rounded-full text-xl font-bold hover:bg-brand-dark transition-all shadow-2xl shadow-brand/30 flex items-center gap-4 mx-auto group"
        >
          <div className="bg-white p-1 rounded-full group-hover:scale-110 transition-transform">
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          </div>
          Sign in with Google
        </button>
      </motion.div>
    </div>
  );
}

function FamilySetup({ onCreate, onJoin }: { onCreate: (n: string) => void, onJoin: (id: string) => void }) {
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose');

  return (
    <div className="min-h-screen bg-brand-light flex items-center justify-center p-4">
      <motion.div 
        layout
        className="bg-white p-10 rounded-[40px] shadow-2xl border border-brand/10 w-full max-w-md"
      >
        <div className="w-20 h-20 bg-brand/10 rounded-3xl flex items-center justify-center mx-auto mb-8 overflow-hidden">
          <img src="/Forage.png" className="w-10 h-10 object-contain" alt="Forage Logo" referrerPolicy="no-referrer" />
        </div>
        <h2 className="text-3xl font-serif text-center mb-2 text-brand">Welcome to Forage</h2>
        <p className="text-center text-brand/60 mb-10">Let's get your family started.</p>
        
        <AnimatePresence mode="wait">
          {mode === 'choose' && (
            <motion.div 
              key="choose"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <button 
                onClick={() => setMode('create')}
                className="w-full p-6 text-left rounded-3xl border-2 border-transparent hover:border-brand bg-brand-light transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-2xl shadow-sm group-hover:scale-110 transition-transform">
                    <Plus className="w-6 h-6 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-brand">Create a Family</h3>
                    <p className="text-sm text-brand/60 italic">Start a new group for your household.</p>
                  </div>
                </div>
              </button>
              <button 
                onClick={() => setMode('join')}
                className="w-full p-6 text-left rounded-3xl border-2 border-transparent hover:border-brand bg-brand-light transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white rounded-2xl shadow-sm group-hover:scale-110 transition-transform">
                    <Users className="w-6 h-6 text-brand" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-brand">Join a Family</h3>
                    <p className="text-sm text-brand/60 italic">Enter a code shared by a family member.</p>
                  </div>
                </div>
              </button>
            </motion.div>
          )}

          {mode === 'create' && (
            <motion.div 
              key="create"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div>
                <label className="block text-sm font-medium mb-2">Family Name</label>
                <input 
                  type="text" 
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. The Smith Family"
                  className="w-full p-4 rounded-xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setMode('choose')} className="flex-1 py-4 text-brand font-bold hover:bg-brand-light rounded-xl transition-colors">Back</button>
                <button 
                  onClick={() => onCreate(name)}
                  disabled={!name}
                  className="flex-[2] py-4 bg-brand text-white rounded-xl font-bold disabled:opacity-50 hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
                >
                  Create
                </button>
              </div>
            </motion.div>
          )}

          {mode === 'join' && (
            <motion.div 
              key="join"
              initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div>
                <label className="block text-sm font-medium mb-2">Family ID</label>
                <input 
                  type="text" 
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  placeholder="Paste family code here"
                  className="w-full p-4 rounded-xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setMode('choose')} className="flex-1 py-4 text-brand font-bold hover:bg-brand-light rounded-xl transition-colors">Back</button>
                <button 
                  onClick={() => onJoin(joinId)}
                  disabled={!joinId}
                  className="flex-[2] py-4 bg-brand text-white rounded-xl font-bold disabled:opacity-50 hover:bg-brand-dark transition-all shadow-lg shadow-brand/20"
                >
                  Join
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function ScholarshipRow({ scholarship, onEdit, setConfirmModal, showToast, familyMembers }: { scholarship: Scholarship, onEdit: () => void, setConfirmModal: (v: any) => void, showToast: (m: string, t?: 'success' | 'error') => void, familyMembers: UserProfile[], key?: React.Key }) {
  const statusConfig = {
    intake: { icon: Info, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Intake' },
    not_applicable: { icon: HelpCircle, color: 'text-gray-600', bg: 'bg-gray-50', label: 'Not Applicable' },
    need_to_apply: { icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Need to Apply' },
    in_progress: { icon: Clock, color: 'text-indigo-600', bg: 'bg-indigo-50', label: 'In Progress' },
    applied: { icon: Send, color: 'text-green-600', bg: 'bg-green-50', label: 'Applied' },
  };

  const config = statusConfig[scholarship.status] || statusConfig.intake;
  const applicableStudents = familyMembers.filter(m => scholarship.applicableStudents?.includes(m.uid));

  return (
    <tr 
      onClick={onEdit}
      className="border-b border-brand/5 hover:bg-brand-light/30 transition-colors group cursor-pointer"
    >
      <td className="px-6 py-4">
        <div className="text-left group/title">
          <p className="font-serif font-bold text-lg text-[#1a1a1a] group-hover/title:text-brand transition-colors">
            {scholarship.title}
          </p>
          <p className="text-xs text-brand/60 font-medium">{scholarship.provider || 'Provider not specified'}</p>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="font-serif font-bold text-brand">
          {scholarship.amount ? `$${scholarship.amount.toLocaleString()}` : '—'}
        </span>
      </td>
      <td className="px-6 py-4">
        <span className="text-sm text-brand/70 flex items-center gap-1.5 font-medium">
          <Calendar className="w-3.5 h-3.5" />
          {scholarship.deadline ? format(scholarship.deadline.toDate(), 'MMM d, yyyy') : 'No date'}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center gap-2">
          {applicableStudents.length > 0 ? (
            <div className="flex -space-x-2">
              {applicableStudents.map(student => (
                <div 
                  key={student.uid}
                  className="w-7 h-7 rounded-full border-2 border-white bg-brand-light flex items-center justify-center overflow-hidden"
                  title={student.displayName}
                >
                  <img 
                    src={student.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.displayName)}&background=random`} 
                    alt={student.displayName}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[10px] text-brand/40 italic font-bold uppercase tracking-wider">Not set</span>
          )}
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", config.bg, config.color)}>
          <config.icon className="w-3 h-3" />
          {config.label}
        </span>
      </td>
    </tr>
  );
}

function ScholarshipForm({ onClose, familyId, userId, editing, showToast, setConfirmModal, familyMembers }: { onClose: () => void, familyId: string, userId: string, editing?: Scholarship | null, showToast: (m: string, t?: 'success' | 'error') => void, setConfirmModal: (v: any) => void, familyMembers: UserProfile[] }) {
  const [formData, setFormData] = useState({
    title: editing?.title || '',
    provider: editing?.provider || '',
    amount: editing?.amount?.toString() || '',
    deadline: editing?.deadline ? format(editing.deadline.toDate(), 'yyyy-MM-dd') : '',
    status: editing?.status || 'intake',
    url: editing?.url || '',
    notes: editing?.notes || '',
    applicableStudents: editing?.applicableStudents || [] as string[],
  });

  const students = familyMembers.filter(m => m.role === 'student');

  const toggleStudent = (studentId: string) => {
    setFormData(prev => ({
      ...prev,
      applicableStudents: prev.applicableStudents.includes(studentId)
        ? prev.applicableStudents.filter(id => id !== studentId)
        : [...prev.applicableStudents, studentId]
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      amount: formData.amount ? parseFloat(formData.amount) : null,
      deadline: formData.deadline ? Timestamp.fromDate(new Date(formData.deadline)) : null,
      familyId,
      updatedAt: serverTimestamp(),
    };

    try {
      if (editing) {
        await updateDoc(doc(db, 'scholarships', editing.id), {
          ...data,
          addedBy: editing.addedBy,
          createdAt: editing.createdAt
        });
        showToast("Scholarship updated!");
      } else {
        await addDoc(collection(db, 'scholarships'), {
          ...data,
          addedBy: userId,
          createdAt: serverTimestamp(),
        });
        showToast("Scholarship added!");
      }
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `scholarships/${editing?.id || 'new'}`);
    }
  };

  const handleDelete = () => {
    if (!editing) return;
    setConfirmModal({
      title: "Delete Scholarship",
      message: "Are you sure you want to delete this scholarship? This action cannot be undone.",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'scholarships', editing.id));
          showToast("Scholarship deleted");
          onClose();
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `scholarships/${editing.id}`);
        } finally {
          setConfirmModal(null);
        }
      }
    });
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="max-w-3xl mx-auto"
    >
      <div className="flex items-center justify-between mb-8">
        <button 
          onClick={onClose}
          className="flex items-center gap-2 text-brand/60 hover:text-brand font-bold transition-colors"
        >
          <ChevronRight className="w-5 h-5 rotate-180" />
          Back to Dashboard
        </button>
        <div className="flex items-center gap-4">
          <h2 className="text-4xl font-serif text-brand font-bold">{editing ? 'Edit' : 'Add'} Scholarship</h2>
        </div>
        {editing && (
          <button 
            onClick={handleDelete}
            className="flex items-center gap-2 text-red-500 hover:text-red-600 font-bold transition-colors"
          >
            <Trash2 className="w-5 h-5" />
            Delete Scholarship
          </button>
        )}
      </div>

      <div className="bg-white rounded-[40px] shadow-sm border border-brand/10 overflow-hidden">
        <div className="p-10 border-b border-brand/10 bg-brand-light/30">
          <h2 className="text-4xl font-serif text-brand font-bold">{editing ? 'Edit' : 'Add'} Scholarship</h2>
          <p className="text-brand/60 font-serif mt-2">Fill in the details for this educational opportunity.</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-10 space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Title *</label>
              <input 
                required
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand text-lg"
                placeholder="e.g. National Merit Scholarship"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Provider</label>
              <input 
                value={formData.provider}
                onChange={e => setFormData({ ...formData, provider: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                placeholder="e.g. College Board"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Amount ($)</label>
              <input 
                type="number"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                placeholder="0.00"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Deadline</label>
              <input 
                type="date"
                value={formData.deadline}
                onChange={e => setFormData({ ...formData, deadline: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Status</label>
              <select 
                value={formData.status}
                onChange={e => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand appearance-none"
              >
                <option value="intake">Intake</option>
                <option value="not_applicable">Not Applicable</option>
                <option value="need_to_apply">Need to Apply</option>
                <option value="in_progress">In Progress</option>
                <option value="applied">Applied</option>
              </select>
            </div>
            <div className="space-y-4 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Applicable Students</label>
              <div className="flex flex-wrap gap-3">
                {students.length > 0 ? (
                  students.map(student => (
                    <button
                      key={student.uid}
                      type="button"
                      onClick={() => toggleStudent(student.uid)}
                      className={cn(
                        "flex items-center gap-3 p-3 pr-5 rounded-2xl border-2 transition-all",
                        formData.applicableStudents.includes(student.uid)
                          ? "bg-brand text-white border-brand shadow-lg shadow-brand/20"
                          : "bg-brand-light border-transparent text-brand/60 hover:border-brand/20"
                      )}
                    >
                      <img 
                        src={student.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.displayName)}&background=random`} 
                        alt={student.displayName}
                        className="w-8 h-8 rounded-full border-2 border-white/20"
                        referrerPolicy="no-referrer"
                      />
                      <span className="font-bold">{student.displayName}</span>
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-brand/40 italic p-4 bg-brand-light rounded-2xl w-full">
                    No students found in your family. Add them in Settings.
                  </p>
                )}
              </div>
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">URL</label>
              <input 
                type="url"
                value={formData.url}
                onChange={e => setFormData({ ...formData, url: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                placeholder="https://..."
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold uppercase tracking-wider text-brand/60 ml-1">Notes</label>
              <textarea 
                rows={4}
                value={formData.notes}
                onChange={e => setFormData({ ...formData, notes: e.target.value })}
                className="w-full p-5 rounded-2xl bg-brand-light border-none focus:ring-2 focus:ring-brand"
                placeholder="Add any extra details..."
              />
            </div>
          </div>
          <div className="pt-6 flex gap-4">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 py-5 border border-brand/20 text-brand rounded-2xl font-bold text-lg hover:bg-brand-light transition-all"
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="flex-[2] py-5 bg-brand text-white rounded-2xl font-bold text-lg shadow-xl shadow-brand/20 hover:bg-brand-dark transition-all"
            >
              {editing ? 'Save Changes' : 'Add Scholarship'}
            </button>
          </div>
        </form>
      </div>
    </motion.div>
  );
}

function FamilySection({ family, profile }: { family: Family | null, profile: UserProfile }) {
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (family?.id) {
      const q = query(collection(db, 'users'), where('familyId', '==', family.id));
      const unsub = onSnapshot(q, (snapshot) => {
        setMembers(snapshot.docs.map(doc => doc.data() as UserProfile));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'users');
      });
      return unsub;
    }
  }, [family?.id]);

  const copyId = () => {
    if (family?.id) {
      navigator.clipboard.writeText(family.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-[32px] p-8 border border-brand/10 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-brand" />
        <h3 className="text-xl font-serif font-bold text-brand">Family Members</h3>
      </div>

      <div className="space-y-4 mb-8">
        {members.map((m) => (
          <div key={m.uid} className="flex items-center gap-4 p-2 rounded-2xl hover:bg-brand-light/50 transition-colors">
            <img src={m.photoURL} className="w-12 h-12 rounded-full border-2 border-brand/20 shadow-sm" alt={m.displayName} />
            <div>
              <p className="font-bold text-brand">{m.displayName}</p>
              <p className="text-xs text-brand/60 font-medium capitalize">{m.role}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="pt-6 border-t border-brand/10">
        <p className="text-xs font-bold uppercase tracking-wider text-brand/60 mb-2">Invite Code</p>
        <div className="flex items-center gap-2 p-3 bg-brand-light rounded-xl">
          <code className="text-xs flex-1 truncate">{family?.id}</code>
          <button onClick={copyId} className="p-1.5 hover:bg-white rounded-lg transition-colors">
            {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-brand" />}
          </button>
        </div>
        <p className="text-[10px] text-brand/40 mt-2 italic">Share this code with family members to join.</p>
      </div>
    </div>
  );
}

function StatsSection({ scholarships }: { scholarships: Scholarship[] }) {
  const stats = {
    total: scholarships?.length || 0,
    applied: scholarships?.filter(s => s.status === 'applied').length || 0,
    totalAmount: scholarships?.filter(s => s.status === 'applied').reduce((acc, s) => acc + (s.amount || 0), 0) || 0,
    upcoming: scholarships?.filter(s => s.status !== 'not_applicable' && s.deadline && s.deadline.toDate() > new Date()).length || 0,
  };

  return (
    <div className="bg-brand rounded-[32px] p-8 text-white shadow-xl shadow-brand/20">
      <h3 className="text-xl font-serif font-bold mb-6">Family Progress</h3>
      
      <div className="space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1">Total Applied</p>
          <p className="text-4xl font-serif font-bold">${stats.totalAmount.toLocaleString()}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 p-4 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Scholarships</p>
            <p className="text-2xl font-serif font-bold">{stats.total}</p>
          </div>
          <div className="bg-white/10 p-4 rounded-2xl">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60 mb-1">Upcoming</p>
            <p className="text-2xl font-serif font-bold">{stats.upcoming}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, familyId, userId, family, profile, scholarships, showToast, setConfirmModal }: { onClose: () => void, familyId: string, userId: string, family: Family | null, profile: UserProfile | null, scholarships: Scholarship[], showToast: (m: string, t?: 'success' | 'error') => void, setConfirmModal: (v: any) => void }) {
  const [isProcessing, setIsProcessing] = useState(false);

  const populateDemoData = async () => {
    setIsProcessing(true);
    try {
      // Demo Scholarships
      const demoScholarships = [
        {
          title: "National Merit Scholarship",
          provider: "National Merit Scholarship Corporation",
          amount: 2500,
          deadline: Timestamp.fromDate(new Date('2026-05-15')),
          status: 'intake',
          url: 'https://www.nationalmerit.org/',
          notes: 'Requires high PSAT scores.',
          familyId,
          addedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        {
          title: "Coca-Cola Scholars Program",
          provider: "Coca-Cola Scholars Foundation",
          amount: 20000,
          deadline: Timestamp.fromDate(new Date('2026-10-31')),
          status: 'need_to_apply',
          url: 'https://www.coca-colascholarsfoundation.org/',
          notes: 'Highly competitive, focused on leadership.',
          familyId,
          addedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        {
          title: "Local Rotary Club Award",
          provider: "Springfield Rotary",
          amount: 1000,
          deadline: Timestamp.fromDate(new Date('2026-04-01')),
          status: 'applied',
          notes: 'Awarded for community service project.',
          familyId,
          addedBy: userId,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }
      ];

      for (const s of demoScholarships) {
        await addDoc(collection(db, 'scholarships'), s);
      }

      // Demo Users (Mock profiles)
      const demoUsers = [
        {
          uid: `demo_student_${Math.random().toString(36).substr(2, 9)}`,
          email: 'demo.student@example.com',
          displayName: 'Demo Student',
          photoURL: 'https://picsum.photos/seed/student/100/100',
          familyId,
          role: 'student'
        },
        {
          uid: `demo_guardian_${Math.random().toString(36).substr(2, 9)}`,
          email: 'demo.guardian@example.com',
          displayName: 'Demo Guardian',
          photoURL: 'https://picsum.photos/seed/guardian/100/100',
          familyId,
          role: 'guardian'
        }
      ];

      for (const u of demoUsers) {
        await setDoc(doc(db, 'users', u.uid), u);
      }

      showToast("Demo data populated successfully!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'demo_data');
    } finally {
      setIsProcessing(false);
    }
  };

  const clearDemoData = async () => {
    setConfirmModal({
      title: "Clear Demo Data",
      message: "Are you sure you want to remove all scholarships and demo users? This will NOT delete your own profile.",
      onConfirm: async () => {
        setIsProcessing(true);
        try {
          // Clear scholarships
          const sQuery = query(collection(db, 'scholarships'), where('familyId', '==', familyId));
          const sDocs = await getDocs(sQuery);
          for (const d of sDocs.docs) {
            await deleteDoc(d.ref);
          }

          // Clear demo users (those with 'demo_' prefix in UID)
          const uQuery = query(collection(db, 'users'), where('familyId', '==', familyId));
          const uDocs = await getDocs(uQuery);
          for (const d of uDocs.docs) {
            if (d.id.startsWith('demo_')) {
              await deleteDoc(d.ref);
            }
          }

          showToast("Demo data cleared successfully!");
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'demo_data');
        } finally {
          setIsProcessing(false);
          setConfirmModal(null);
        }
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1a1a1a]/40 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-brand/10 flex items-center justify-between shrink-0 bg-brand-light/50">
          <h2 className="text-2xl font-serif text-brand">Settings & Family</h2>
          <button onClick={onClose} className="p-2 hover:bg-brand-light rounded-full text-brand"><Plus className="w-6 h-6 rotate-45" /></button>
        </div>
        
        <div className="p-8 space-y-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h3 className="text-lg font-serif font-bold text-brand">Family Members</h3>
              <FamilySection family={family} profile={profile} />
              
              <h3 className="text-lg font-serif font-bold text-brand">Progress Stats</h3>
              <StatsSection scholarships={scholarships} />
            </div>

            <div className="space-y-6">
              <h3 className="text-lg font-serif font-bold text-brand">Demo Tools</h3>
              <div className="space-y-4">
                <p className="text-sm text-brand/60 italic">
                  Use these tools to quickly test the application features with sample data.
                </p>
                
                <button 
                  onClick={populateDemoData}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-brand-light hover:bg-brand/10 transition-all group disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-xl text-brand">
                      <Database className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-brand">Populate Demo Data</p>
                      <p className="text-xs text-brand/60">Add scholarships & family members</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-brand/40 group-hover:translate-x-1 transition-transform" />
                </button>

                <button 
                  onClick={clearDemoData}
                  disabled={isProcessing}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-red-50 hover:bg-red-100 transition-all group disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white rounded-xl text-red-500">
                      <Trash className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-red-600">Clear Demo Data</p>
                      <p className="text-xs text-red-400">Remove all demo content</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-red-300 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button 
              onClick={onClose}
              className="w-full py-4 border border-brand/20 text-brand rounded-2xl font-bold hover:bg-brand-light transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function BoardColumn({ id, title, scholarships, onEdit, familyMembers }: { id: string, title: string, scholarships: Scholarship[], onEdit: (s: Scholarship) => void, familyMembers: UserProfile[] }) {
  return (
    <div className="flex flex-col gap-4 bg-brand-light/50 rounded-[32px] p-4 border border-brand/5">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-xs font-bold uppercase tracking-wider text-brand/60">{title}</h3>
        <span className="text-[10px] font-bold bg-brand/10 text-brand/60 px-2 py-0.5 rounded-full">{scholarships.length}</span>
      </div>

      <Droppable droppableId={id}>
        {(provided, snapshot) => (
          <div
            {...provided.droppableProps}
            ref={provided.innerRef}
            className={cn(
              "flex-1 space-y-3 min-h-[100px] transition-colors rounded-2xl p-1",
              snapshot.isDraggingOver ? "bg-brand/5" : ""
            )}
          >
            {scholarships.map((s, index) => {
              const DraggableComp = Draggable as any;
              const applicableStudents = familyMembers.filter(m => s.applicableStudents?.includes(m.uid));
              
              return (
                <DraggableComp key={s.id} draggableId={s.id} index={index}>
                  {(provided: any, snapshot: any) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      onClick={() => onEdit(s)}
                      className={cn(
                        "bg-white p-4 rounded-2xl border border-brand/10 shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing",
                        snapshot.isDragging ? "shadow-xl rotate-2" : ""
                      )}
                    >
                      <p className="font-serif font-bold text-[#1a1a1a] mb-1 line-clamp-2 group-hover:text-brand transition-colors">{s.title}</p>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] text-brand/60 truncate font-medium">{s.provider || 'No provider'}</p>
                        {s.amount && (
                          <span className="text-[10px] font-bold text-brand shrink-0">${s.amount.toLocaleString()}</span>
                        )}
                      </div>
                      
                      {applicableStudents.length > 0 && (
                        <div className="flex -space-x-1.5 pt-1 border-t border-brand/5">
                          {applicableStudents.map(student => (
                            <div 
                              key={student.uid}
                              className="w-5 h-5 rounded-full border-2 border-white bg-brand-light flex items-center justify-center overflow-hidden"
                              title={student.displayName}
                            >
                              <img 
                                src={student.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.displayName)}&background=random`} 
                                alt={student.displayName}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                              />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </DraggableComp>
              );
            })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
