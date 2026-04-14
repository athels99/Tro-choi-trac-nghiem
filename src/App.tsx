/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Volume2, VolumeX, Plus, Trash2, Users, Search, 
  Download, RefreshCw, Shuffle, Settings, X, Check,
  Trophy, Clock, Target, Save, LogOut
} from 'lucide-react';
import { supabase } from './lib/supabase';

// --- TIỆN ÍCH TẠO ÂM THANH (Web Audio API) ---
let audioCtx: AudioContext | null = null;

const playTone = (freq: number, type: OscillatorType, duration: number, vol = 0.1) => {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(vol, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.error("Audio error:", e);
  }
};

const sounds = {
  hover: () => playTone(600, 'sine', 0.1, 0.05),
  correct: () => {
    playTone(440, 'sine', 0.1, 0.1);
    setTimeout(() => playTone(554, 'sine', 0.1, 0.1), 100);
    setTimeout(() => playTone(659, 'sine', 0.2, 0.1), 200);
  },
  wrong: () => {
    playTone(300, 'sawtooth', 0.3, 0.1);
    setTimeout(() => playTone(250, 'sawtooth', 0.4, 0.1), 150);
  },
  congrats: () => {
    [523, 659, 783, 1046].forEach((freq, i) => {
      setTimeout(() => playTone(freq, 'square', 0.2, 0.1), i * 150);
    });
  }
};

// --- DỮ LIỆU MẶC ĐỊNH ---
const generateInitialQuestions = () => {
  return Array.from({ length: 60 }, (_, i) => ({
    id: i + 1,
    displayNumber: i + 1,
    text: `Nội dung câu hỏi trắc nghiệm số ${i + 1} là gì?`,
    options: ['Đáp án A', 'Đáp án B', 'Đáp án C', 'Đáp án D'],
    correctOption: 0, 
    isAnswered: false,
    answeredBy: null as string | null
  }));
};

export default function App() {
  // --- AUTH STATE ---
  const [session, setSession] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authError, setAuthError] = useState('');

  // --- APP STATE ---
  const [classData, setClassData] = useState<Record<string, any[]>>({});
  const [className, setClassName] = useState("");
  const [classesList, setClassesList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  const students = classData[className] || [];

  // Listen for auth changes
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // Fetch initial data from Supabase
  useEffect(() => {
    if (!session) return;

    const fetchInitialData = async () => {
      try {
        setIsLoading(true);
        
        // Fetch Settings
        const { data: settingsData } = await supabase.from('settings').select('*').eq('user_id', session.user.id).single();
        if (settingsData) {
          setTimerSetting(settingsData.timer_setting || 10);
          setInputTimer(settingsData.timer_setting || 10);
          setTargetScore(settingsData.target_score || 100);
        }

        // Fetch Classes
        const { data: classesData, error: classesError } = await supabase.from('classes').select('*').eq('user_id', session.user.id).order('created_at', { ascending: true });
        if (classesError) throw classesError;
        
        if (classesData && classesData.length > 0) {
          setClassesList(classesData);
          const firstClassName = classesData[0].name;
          setClassName(firstClassName);
          
          // Fetch Students (filtered by class_id later, but RLS ensures we only get our students)
          const { data: studentsData, error: studentsError } = await supabase.from('students').select('*');
          if (studentsError) throw studentsError;
          
          const newClassData: Record<string, any[]> = {};
          classesData.forEach(c => {
            newClassData[c.name] = studentsData?.filter(s => s.class_id === c.id) || [];
          });
          setClassData(newClassData);
        } else {
          // If no classes exist, create default '9B'
          const { data: newClass } = await supabase.from('classes').insert([{ name: '9B', user_id: session.user.id }]).select().single();
          if (newClass) {
            setClassesList([newClass]);
            setClassName('9B');
            setClassData({ '9B': [] });
          }
        }

        // Fetch Questions
        const { data: questionsData, error: questionsError } = await supabase.from('questions').select('*').eq('user_id', session.user.id).order('display_number', { ascending: true });
        if (questionsError) throw questionsError;
        
        if (questionsData && questionsData.length > 0) {
          // Lọc bỏ các câu hỏi bị trùng lặp (do React Strict Mode gọi useEffect 2 lần khi khởi tạo)
          const uniqueQuestions: any[] = [];
          const seenNumbers = new Set();
          const duplicateIds: string[] = [];

          questionsData.forEach(q => {
            if (!seenNumbers.has(q.display_number)) {
              seenNumbers.add(q.display_number);
              uniqueQuestions.push(q);
            } else {
              duplicateIds.push(q.id);
            }
          });

          // Xóa các câu hỏi trùng lặp trên Supabase (chạy ngầm)
          if (duplicateIds.length > 0) {
            supabase.from('questions').delete().in('id', duplicateIds).then();
          }

          // Map snake_case to camelCase for frontend
          const formattedQuestions = uniqueQuestions.map(q => ({
            id: q.id,
            displayNumber: q.display_number,
            text: q.text,
            options: q.options,
            correctOption: q.correct_option,
            isAnswered: q.is_answered,
            answeredBy: q.answered_by
          }));
          setQuestions(formattedQuestions);
        } else {
          // Initialize questions if empty
          const initialQs = generateInitialQuestions();
          const dbQuestions = initialQs.map(q => ({
            display_number: q.displayNumber,
            text: q.text,
            options: q.options,
            correct_option: q.correctOption,
            is_answered: q.isAnswered,
            answered_by: q.answeredBy,
            user_id: session.user.id
          }));
          const { data: insertedQs } = await supabase.from('questions').insert(dbQuestions).select();
          if (insertedQs) {
             const formattedQs = insertedQs.map(q => ({
                id: q.id,
                displayNumber: q.display_number,
                text: q.text,
                options: q.options,
                correctOption: q.correct_option,
                isAnswered: q.is_answered,
                answeredBy: q.answered_by
             }));
             setQuestions(formattedQs);
          }
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        showAlert("Lỗi", "Không thể tải dữ liệu từ máy chủ.");
      } finally {
        setIsLoading(false);
      }
    };

    fetchInitialData();
  }, [session]);

  // Update setStudents to also update Supabase (for local state updates that don't need immediate DB sync, we'll handle DB sync separately)
  const setStudents = useCallback((action: any) => {
    setClassData(prev => {
      const currentList = prev[className] || [];
      const newList = typeof action === 'function' ? action(currentList) : action;
      return { ...prev, [className]: newList };
    });
  }, [className]);

  const [studentNameInput, setStudentNameInput] = useState('');
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);

  useEffect(() => { setActiveStudentId(null); }, [className]);

  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const STUDENTS_PER_PAGE = 5; 

  const [showBatchInputModal, setShowBatchInputModal] = useState(false);
  const [batchInputText, setBatchInputText] = useState("");

  const [questions, setQuestions] = useState<any[]>([]);
  const [timerSetting, setTimerSetting] = useState(10);
  const [inputTimer, setInputTimer] = useState(10);
  
  const [targetScore, setTargetScore] = useState(100);

  const [activeQuestion, setActiveQuestion] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showResultFeedback, setShowResultFeedback] = useState<'correct' | 'wrong' | null>(null);

  const [isManagementMode, setIsManagementMode] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);

  const [isBgmPlaying, setIsBgmPlaying] = useState(false);
  const bgmRef = useRef<HTMLAudioElement>(null);

  // Custom Modals State
  const [addClassModalOpen, setAddClassModalOpen] = useState(false);
  const [newClassNameInput, setNewClassNameInput] = useState('');
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [alertDialog, setAlertDialog] = useState({ isOpen: false, title: '', message: '' });

  const showAlert = (title: string, message: string) => setAlertDialog({ isOpen: true, title, message });
  const showConfirm = (title: string, message: string, onConfirm: () => void) => setConfirmDialog({ isOpen: true, title, message, onConfirm });

  // --- LOGIC ---
  const filteredStudents = students.filter(student =>
    student.name.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  const totalPages = Math.max(1, Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (safeCurrentPage - 1) * STUDENTS_PER_PAGE;
  const currentStudents = filteredStudents.slice(startIndex, startIndex + STUDENTS_PER_PAGE);

  useEffect(() => { setCurrentPage(1); }, [searchTerm]);

  const handleAddClassClick = () => {
    setNewClassNameInput('');
    setAddClassModalOpen(true);
  };

  const confirmAddClass = async () => {
    if (newClassNameInput && newClassNameInput.trim() !== "") {
      const trimmedName = newClassNameInput.trim();
      if (!classData[trimmedName]) {
        try {
          const { data, error } = await supabase.from('classes').insert([{ name: trimmedName, user_id: session.user.id }]).select().single();
          if (error) throw error;
          if (data) {
            setClassesList(prev => [...prev, data]);
            setClassData(prev => ({ ...prev, [trimmedName]: [] }));
            setClassName(trimmedName);
          }
        } catch (error) {
          console.error("Error adding class:", error);
          showAlert("Lỗi", "Không thể thêm lớp mới.");
        }
      } else {
        setClassName(trimmedName);
      }
    }
    setAddClassModalOpen(false);
  };

  const handleDeleteClass = () => {
    if (Object.keys(classData).length <= 1) { 
      showAlert("Không thể xóa", "Phải giữ lại ít nhất 1 lớp trong danh sách!"); 
      return; 
    }
    showConfirm("Xác nhận xóa", `Bạn có chắc chắn muốn XÓA LỚP "${className}"?`, async () => {
      try {
        const classToDelete = classesList.find(c => c.name === className);
        if (classToDelete) {
          const { error } = await supabase.from('classes').delete().eq('id', classToDelete.id);
          if (error) throw error;
        }
        
        const newData = { ...classData };
        delete newData[className];
        setClassData(newData);
        const remainingClasses = classesList.filter(c => c.name !== className);
        setClassesList(remainingClasses);
        setClassName(Object.keys(newData)[0]);
      } catch (error) {
        console.error("Error deleting class:", error);
        showAlert("Lỗi", "Không thể xóa lớp.");
      }
    });
  };

  const handleAddStudent = async () => {
    if (!studentNameInput.trim()) return;
    const currentClass = classesList.find(c => c.name === className);
    if (!currentClass) return;

    try {
      const { data, error } = await supabase.from('students').insert([{ 
        class_id: currentClass.id, 
        name: studentNameInput.trim(), 
        score: 0,
        answered_questions: []
      }]).select().single();
      
      if (error) throw error;
      
      if (data) {
        setStudents([...students, data]);
        setStudentNameInput('');
        if (!activeStudentId) setActiveStudentId(data.id);
      }
    } catch (error) {
      console.error("Error adding student:", error);
      showAlert("Lỗi", "Không thể thêm học sinh.");
    }
  };

  const handleRemoveStudent = async (id: string) => {
    try {
      const { error } = await supabase.from('students').delete().eq('id', id);
      if (error) throw error;
      
      setStudents(students.filter(s => s.id !== id));
      if (activeStudentId === id) setActiveStudentId(null);
    } catch (error) {
      console.error("Error removing student:", error);
      showAlert("Lỗi", "Không thể xóa học sinh.");
    }
  };

  const handleSaveBatchInput = async () => {
    const newNames = batchInputText.split(/\r?\n/).filter(name => name.trim() !== '');
    const currentClass = classesList.find(c => c.name === className);
    
    if (newNames.length > 0 && currentClass) {
      try {
        const newStudentsData = newNames.map(name => ({
          class_id: currentClass.id,
          name: name.trim(),
          score: 0,
          answered_questions: []
        }));
        
        const { data, error } = await supabase.from('students').insert(newStudentsData).select();
        if (error) throw error;
        
        if (data) {
          setStudents((prev: any) => [...prev, ...data]);
          showAlert("Thành công", `Đã thêm thành công ${data.length} học sinh!`);
        }
      } catch (error) {
        console.error("Error batch adding students:", error);
        showAlert("Lỗi", "Không thể thêm danh sách học sinh.");
      }
    }
    setShowBatchInputModal(false);
    setBatchInputText("");
  };

  const handleClearAllStudents = () => {
    const currentClass = classesList.find(c => c.name === className);
    if (!currentClass) return;

    showConfirm("Xác nhận xóa", `Xóa toàn bộ danh sách học sinh của lớp ${className}?`, async () => {
      try {
        const { error } = await supabase.from('students').delete().eq('class_id', currentClass.id);
        if (error) throw error;
        
        setStudents([]);
        setActiveStudentId(null);
      } catch (error) {
        console.error("Error clearing students:", error);
        showAlert("Lỗi", "Không thể xóa danh sách học sinh.");
      }
    });
  };

  const handleExportResults = () => {
    if (students.length === 0) { showAlert("Thông báo", "Chưa có dữ liệu học sinh để xuất!"); return; }
    const sortedStudents = [...students].sort((a, b) => b.score - a.score);
    const dataToExport = sortedStudents.map((s, index) => ({ 
      "Hạng": index + 1, 
      "Lớp": className, 
      "Tên Học Sinh": s.name, 
      "Điểm": s.score 
    }));
    
    const jsonString = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `KetQua_Lop_${className}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleSetTimer = async () => { 
    try {
      const { error } = await supabase.from('settings').upsert({ user_id: session.user.id, timer_setting: inputTimer, target_score: targetScore }, { onConflict: 'user_id' });
      if (error) throw error;
      setTimerSetting(inputTimer); 
      showAlert("Thành công", `Đã cài đặt thời gian: ${inputTimer} giây`); 
    } catch (error) {
      console.error("Error saving timer:", error);
      showAlert("Lỗi", "Không thể lưu cài đặt thời gian.");
    }
  };

  const handleResetScores = () => { 
    const currentClass = classesList.find(c => c.name === className);
    if (!currentClass) return;

    showConfirm("Xác nhận", "Bạn có chắc muốn làm mới điểm số?", async () => {
      try {
        const { error } = await supabase.from('students').update({ score: 0 }).eq('class_id', currentClass.id);
        if (error) throw error;
        setStudents(students.map(s => ({...s, score: 0})));
      } catch (error) {
        console.error("Error resetting scores:", error);
        showAlert("Lỗi", "Không thể làm mới điểm số.");
      }
    }); 
  };

  const handleResetQuestions = () => { 
    const currentClass = classesList.find(c => c.name === className);
    if (!currentClass) return;

    showConfirm("Xác nhận", "Làm mới trạng thái tất cả câu hỏi của lớp này?", async () => {
      try {
        const { error } = await supabase.from('students').update({ answered_questions: [] }).eq('class_id', currentClass.id);
        if (error) throw error;
        setStudents(students.map(s => ({...s, answered_questions: []})));
      } catch (error) {
        console.error("Error resetting questions:", error);
        showAlert("Lỗi", "Không thể làm mới câu hỏi.");
      }
    }); 
  };

  const handleShuffleQuestions = () => {
    let shuffled = [...questions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    setQuestions(shuffled.map((q, index) => ({ ...q, displayNumber: index + 1 })));
  };

  const openQuestion = (question: any) => {
    if (!activeStudentId) { showAlert("Thông báo", "Vui lòng chọn một học sinh trước khi chọn câu hỏi!"); return; }
    const activeStudent = students.find(s => s.id === activeStudentId);
    if (activeStudent?.answered_questions?.includes(question.id)) return;
    
    setActiveQuestion(question);
    setTimeLeft(timerSetting);
    setIsTimerRunning(true);
    setShowResultFeedback(null);
  };

  const closeQuestionModal = () => { setActiveQuestion(null); setIsTimerRunning(false); setShowResultFeedback(null); };

  const handleAnswerSelection = async (selectedIndex: number) => {
    setIsTimerRunning(false);
    const isCorrect = selectedIndex === activeQuestion.correctOption;
    
    try {
      const student = students.find(s => s.id === activeStudentId);
      if (!student) throw new Error("No active student");

      const newScore = isCorrect ? student.score + 10 : student.score;
      const newAnswered = [...(student.answered_questions || []), activeQuestion.id];

      if (isCorrect) {
        sounds.correct(); sounds.congrats(); setShowResultFeedback('correct');
      } else {
        sounds.wrong(); setShowResultFeedback('wrong');
      }
      
      // Update student in Supabase
      await supabase.from('students').update({ 
        score: newScore,
        answered_questions: newAnswered
      }).eq('id', activeStudentId);
      
      setStudents(students.map(s => s.id === activeStudentId ? { ...s, score: newScore, answered_questions: newAnswered } : s));
      
    } catch (error) {
      console.error("Error updating answer:", error);
      showAlert("Lỗi", "Không thể lưu kết quả câu trả lời.");
    }

    setTimeout(() => closeQuestionModal(), 2000);
  };

  useEffect(() => {
    let timer: any;
    if (isTimerRunning && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0 && isTimerRunning) {
      setIsTimerRunning(false);
      sounds.wrong(); setShowResultFeedback('wrong');
      
      const student = students.find(s => s.id === activeStudentId);
      if (student) {
        const newAnswered = [...(student.answered_questions || []), activeQuestion.id];
        supabase.from('students').update({ 
          answered_questions: newAnswered 
        }).eq('id', activeStudentId).then(() => {
          setStudents(students.map(s => s.id === activeStudentId ? { ...s, answered_questions: newAnswered } : s));
        }).catch(err => console.error("Error updating timeout:", err));
      }
      
      setTimeout(() => closeQuestionModal(), 2000);
    }
    return () => clearInterval(timer);
  }, [isTimerRunning, timeLeft, activeQuestion, activeStudentId, students]);

  const saveEditedQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { error } = await supabase.from('questions').update({
        text: editingQuestion.text,
        options: editingQuestion.options,
        correct_option: editingQuestion.correctOption
      }).eq('id', editingQuestion.id);
      
      if (error) throw error;
      
      setQuestions(questions.map(q => q.id === editingQuestion.id ? editingQuestion : q));
      setEditingQuestion(null);
      showAlert("Thành công", "Đã lưu câu hỏi!");
    } catch (error) {
      console.error("Error saving question:", error);
      showAlert("Lỗi", "Không thể lưu câu hỏi.");
    }
  };

  const topStudents = [...students].sort((a, b) => b.score - a.score).slice(0, 3);
  const avatarColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

  // Group students by score to assign lanes and prevent overlap
  const scoreGroups: Record<number, string[]> = {};
  students.forEach(s => {
    if (!scoreGroups[s.score]) scoreGroups[s.score] = [];
    scoreGroups[s.score].push(s.id);
  });

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email: authEmail, password: authPassword });
        if (error) throw error;
        showAlert("Thành công", "Đăng ký thành công! Vui lòng đăng nhập.");
        setIsLoginMode(true);
      }
    } catch (err: any) {
      setAuthError(err.message || "Đã xảy ra lỗi xác thực.");
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (isAuthLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-4"></div>
        <p className="text-slate-600 font-semibold">Đang kiểm tra đăng nhập...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-md border border-slate-200">
          <div className="flex justify-center mb-6">
            <Trophy className="text-yellow-500" size={48} />
          </div>
          <h2 className="text-2xl font-black text-center text-slate-800 mb-6 uppercase tracking-tight">
            {isLoginMode ? 'Đăng nhập' : 'Đăng ký tài khoản'}
          </h2>
          {authError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-medium mb-4 border border-red-200">
              {authError}
            </div>
          )}
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Email</label>
              <input 
                type="email" 
                value={authEmail} 
                onChange={(e) => setAuthEmail(e.target.value)} 
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                required 
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">Mật khẩu</label>
              <input 
                type="password" 
                value={authPassword} 
                onChange={(e) => setAuthPassword(e.target.value)} 
                className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none" 
                required 
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl shadow-md transition-colors mt-2">
              {isLoginMode ? 'Đăng nhập' : 'Đăng ký'}
            </button>
          </form>
          <div className="mt-6 text-center">
            <button onClick={() => setIsLoginMode(!isLoginMode)} className="text-blue-600 hover:underline text-sm font-semibold">
              {isLoginMode ? 'Chưa có tài khoản? Đăng ký ngay' : 'Đã có tài khoản? Đăng nhập'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mb-4"></div>
        <p className="text-slate-600 font-semibold">Đang tải dữ liệu từ máy chủ...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-full font-sans flex flex-col overflow-hidden bg-slate-50">
      
      <audio ref={bgmRef} loop src="https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3" preload="auto" />

      {/* --- MAIN LAYOUT --- */}
      <div className="flex flex-col lg:flex-row flex-1 p-3 sm:p-4 gap-4 lg:gap-6 min-h-0 w-full max-w-[1600px] mx-auto">
        
        {/* --- LEFT PANEL: HỌC SINH --- */}
        <div className="w-full lg:w-[320px] relative flex-shrink-0 flex flex-col h-[600px] lg:h-full z-20 rounded-3xl shadow-xl overflow-hidden border border-slate-200 bg-white p-4">
          
          <div className="flex items-center justify-between mb-4 mt-2">
            <div className="flex items-center gap-2 text-blue-700 font-bold">
              <Users size={20} />
              <span>LỚP:</span>
            </div>
            <div className="flex-1 mx-2 relative">
              <select 
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                className="w-full appearance-none bg-blue-50 border border-blue-200 text-blue-800 font-bold rounded-lg py-1.5 pl-3 pr-8 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                {Object.keys(classData).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500">
                ▼
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={handleAddClassClick} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Thêm lớp mới">
                <Plus size={18} />
              </button>
              <button onClick={handleDeleteClass} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Xóa lớp">
                <Trash2 size={18} />
              </button>
            </div>
          </div>

          {/* Khung nhập tên */}
          <div className="relative flex items-center bg-slate-50 rounded-xl border border-slate-200 mb-4 h-12 flex-shrink-0 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
            <input 
              type="text" 
              placeholder="Nhập tên học sinh..." 
              value={studentNameInput}
              onChange={(e) => setStudentNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddStudent()}
              className="flex-1 px-4 py-2 bg-transparent outline-none text-slate-700 text-sm font-medium w-full"
            />
            <button 
              onClick={handleAddStudent}
              className="mr-1 bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700 transition-colors"
            >
              Thêm
            </button>
          </div>

          <button 
            onClick={() => setShowBatchInputModal(true)} 
            className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2.5 px-4 rounded-xl font-semibold border border-indigo-100 transition-colors flex justify-center items-center gap-2 mb-4 text-sm"
          >
            <Users size={16} /> Quản lý danh sách
          </button>

          <div className="relative mb-4 flex-shrink-0">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
             <input
               type="text"
               placeholder="Tìm kiếm..."
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="w-full pl-9 pr-4 py-2 text-sm rounded-xl outline-none border border-slate-200 focus:ring-2 focus:ring-blue-500 bg-slate-50"
             />
          </div>

          {/* Danh sách học sinh */}
          <div className="flex-1 flex flex-col justify-between mb-2 overflow-y-auto custom-scrollbar pr-1">
            <div className="space-y-2">
              {currentStudents.map(student => {
                const isActive = activeStudentId === student.id;
                return (
                  <div 
                    key={student.id} 
                    onClick={() => setActiveStudentId(student.id)}
                    className={`flex justify-between items-center px-4 py-3 rounded-xl cursor-pointer border transition-all ${
                      isActive 
                        ? 'bg-blue-600 border-blue-600 text-white shadow-md transform scale-[1.02]' 
                        : 'bg-white border-slate-100 hover:border-blue-200 hover:shadow-sm text-slate-700'
                    }`}
                  >
                    <div className="flex flex-col min-w-0 flex-1 pr-2">
                      <span className="font-bold text-sm truncate" title={student.name}>{student.name}</span>
                      <span className={`text-xs mt-0.5 ${isActive ? 'text-blue-100' : 'text-slate-500'}`}>{student.score} điểm</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isActive && <Check size={18} className="text-white" />}
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRemoveStudent(student.id); }}
                        className={`p-1 transition-colors ${isActive ? 'text-blue-200 hover:text-red-200' : 'text-slate-300 hover:text-red-500'}`}
                        title="Xóa học sinh"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {students.length === 0 && (
                <div className="text-center text-slate-500 mt-8 text-sm flex flex-col items-center gap-2">
                  <Users size={32} className="text-slate-300" />
                  <p>Chưa có học sinh nào.</p>
                </div>
              )}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-100 shrink-0">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={safeCurrentPage === 1} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs text-slate-700 rounded-lg font-semibold transition-colors">Trước</button>
                <span className="text-slate-500 font-medium text-xs">{safeCurrentPage} / {totalPages}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={safeCurrentPage === totalPages} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-xs text-slate-700 rounded-lg font-semibold transition-colors">Sau</button>
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT PANEL: MAIN CONTENT --- */}
        <div className="flex-1 flex flex-col h-full min-w-0 z-10 relative">
          
          {/* TOP ROW: Title, Controls & Leaderboard */}
          <div className="flex flex-col lg:flex-row justify-between items-start gap-4 mb-4 shrink-0 w-full">
            
            <div className="flex flex-col gap-4 flex-1">
               <h1 className="text-3xl lg:text-4xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                 <Trophy className="text-yellow-500" size={36} />
                 ĐƯỜNG LÊN ĐỈNH OLYMPIA
               </h1>

               {/* CONTROLS ROW */}
               <div className="flex items-center gap-2 shrink-0 overflow-x-auto pb-2 w-full custom-scrollbar">
                 <div className="flex items-center bg-white px-2 py-1.5 rounded-lg shadow-sm border border-slate-200 shrink-0">
                    <Clock size={14} className="text-slate-500 mr-1" />
                    <span className="font-semibold text-slate-700 text-xs mr-1 whitespace-nowrap">Thời gian:</span>
                    <input type="number" value={inputTimer} onChange={(e) => setInputTimer(Number(e.target.value))} className="w-10 p-0.5 border border-slate-200 rounded text-center outline-none font-bold focus:ring-2 focus:ring-blue-500 text-xs" />
                    <button onClick={handleSetTimer} className="bg-blue-50 text-blue-600 hover:bg-blue-100 px-1.5 py-0.5 ml-1 rounded text-xs font-bold transition-colors whitespace-nowrap">Lưu</button>
                 </div>

                 <div className="flex items-center bg-white px-2 py-1.5 rounded-lg shadow-sm border border-slate-200 shrink-0">
                    <Target size={14} className="text-slate-500 mr-1" />
                    <span className="font-semibold text-slate-700 text-xs mr-1 whitespace-nowrap">Điểm đích:</span>
                    <input type="number" value={targetScore} onChange={(e) => setTargetScore(Number(e.target.value))} className="w-10 p-0.5 border border-slate-200 rounded text-center outline-none font-bold focus:ring-2 focus:ring-green-500 text-xs" />
                 </div>

                 <button onClick={handleResetQuestions} className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                   <RefreshCw size={14} /> Reset câu hỏi
                 </button>
                 <button onClick={handleResetScores} className="bg-white border border-slate-200 hover:bg-red-50 text-red-600 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                   <RefreshCw size={14} /> Reset điểm
                 </button>
                 <button onClick={handleShuffleQuestions} className="bg-white border border-slate-200 hover:bg-purple-50 text-purple-600 px-2.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                   <Shuffle size={14} /> Trộn
                 </button>
                 <button onClick={() => setIsManagementMode(true)} className="bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap ml-auto">
                   <Settings size={14} /> Quản lý
                 </button>
                 <button onClick={handleLogout} className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap">
                   <LogOut size={14} /> Đăng xuất
                 </button>
               </div>
            </div>

            {/* LEADERBOARD */}
            <div className="w-full lg:w-[280px] bg-white rounded-2xl border border-slate-200 p-4 shadow-sm shrink-0">
               <h3 className="font-bold text-slate-800 text-sm mb-3 flex items-center gap-2 uppercase tracking-wider">
                 <Trophy size={16} className="text-yellow-500" /> Bảng xếp hạng
               </h3>
               <div className="space-y-2">
                  {topStudents.length > 0 ? topStudents.map((st, idx) => (
                    <div key={st.id} className="flex justify-between items-center px-3 py-2 bg-slate-50 rounded-lg border border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉'}</span>
                        <span className="font-semibold text-sm text-slate-700 truncate max-w-[120px]" title={st.name}>{st.name}</span>
                      </div>
                      <span className="text-blue-600 font-bold text-sm bg-blue-50 px-2 py-0.5 rounded">{st.score}</span>
                    </div>
                  )) : (
                    <div className="text-center text-slate-400 italic py-4 text-sm bg-slate-50 rounded-lg border border-slate-100">Chưa có dữ liệu</div>
                  )}
               </div>
            </div>
          </div>

          {/* MAIN CONTENT AREA: Split Vertically (Grid Top, Race Bottom) */}
          <div className="flex-1 w-full flex flex-col overflow-hidden rounded-3xl border border-slate-200 shadow-sm bg-white">
            
            {/* GRID CÂU HỎI */}
            <div className="flex-1 p-4 sm:p-6 flex items-center justify-center overflow-y-auto custom-scrollbar bg-slate-50/50">
              <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-3 sm:gap-4 justify-items-center w-full max-w-5xl mx-auto">
                {questions.map((q) => {
                  const activeStudent = students.find(s => s.id === activeStudentId);
                  const isAnswered = activeStudent?.answered_questions?.includes(q.id) || false;
                  return (
                  <button
                    key={q.id}
                    onClick={() => openQuestion(q)}
                    onMouseEnter={sounds.hover}
                    disabled={isAnswered}
                    className={`
                      w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center transition-all duration-200 relative overflow-hidden group
                      ${isAnswered 
                        ? 'bg-slate-100 border border-slate-200 cursor-not-allowed opacity-50 grayscale' 
                        : 'bg-white border-2 border-blue-100 hover:border-blue-500 hover:-translate-y-1 hover:shadow-md cursor-pointer shadow-sm'}
                    `}
                  >
                    <img 
                      src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${(q.displayNumber % 151) === 0 ? 151 : (q.displayNumber % 151)}.png`} 
                      alt={`Question ${q.displayNumber}`}
                      className="w-12 h-12 sm:w-14 sm:h-14 object-contain transition-transform duration-300 group-hover:scale-125 drop-shadow-sm"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <div className="absolute bottom-0 right-0 bg-blue-100 text-blue-800 text-[10px] sm:text-xs font-black px-1.5 py-0.5 rounded-tl-lg border-t border-l border-blue-200">
                      {q.displayNumber}
                    </div>
                  </button>
                )})}
              </div>
            </div>

            {/* BẢN ĐỒ ĐUA HIỆP SĨ */}
            <div className="h-[160px] lg:h-[200px] w-full border-t border-slate-200 bg-emerald-50 relative shrink-0 overflow-hidden">
               <svg viewBox="0 0 1200 200" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
                  {/* Background fill */}
                  <rect width="1200" height="200" fill="#ecfdf5" />
                  
                  {/* Straight Road */}
                  <line x1="80" y1="110" x2="1050" y2="110" stroke="#d1fae5" strokeWidth="80" strokeLinecap="round" />
                  <line x1="80" y1="100" x2="1050" y2="100" stroke="#e2e8f0" strokeWidth="70" strokeLinecap="round" />
                  <line x1="80" y1="100" x2="1050" y2="100" stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" strokeDasharray="15 25"/>

                  {/* Start & End Decorations */}
                  <text x="30" y="115" fontSize="40">🚩</text>
                  <text x="1080" y="130" fontSize="70">🏰</text>

                  {/* Students Avatars (Knights) */}
                  {students.map((s, idx) => {
                     let p = s.score / targetScore;
                     if (p < 0) p = 0;
                     if (p > 1) p = 1;

                     const startX = 80;
                     const endX = 1050;
                     const x = startX + p * (endX - startX);

                     // Distribute knights vertically based on score group to prevent overlap
                     const laneIndex = scoreGroups[s.score].indexOf(s.id);
                     const totalInGroup = scoreGroups[s.score].length;
                     const yOffset = (laneIndex - (totalInGroup - 1) / 2) * 25; 
                     const y = 100 + yOffset;
                     
                     const color = avatarColors[idx % avatarColors.length];
                     const isActive = s.id === activeStudentId;

                     return (
                       <g key={s.id} style={{ transform: `translate(${x}px, ${y}px)` }} className="transition-transform duration-1000 ease-in-out">
                          {isActive && <circle cx="0" cy="-15" r="35" fill="rgba(59, 130, 246, 0.2)" className="animate-pulse" />}

                          {/* Cute Character */}
                          <g transform="translate(-15, -40) scale(1.1)">
                             {/* Body */}
                             <rect x="5" y="20" width="14" height="12" fill={color} rx="3" />
                             {/* Head */}
                             <circle cx="12" cy="12" r="8" fill="#fed7aa"/>
                             <circle cx="9" cy="11" r="1.5" fill="#000"/>
                             <circle cx="15" cy="11" r="1.5" fill="#000"/>
                             <path d="M 10 15 Q 12 17 14 15" fill="none" stroke="#000" strokeWidth="1" strokeLinecap="round"/>
                          </g>

                          {/* Name Tag */}
                          <rect x="-35" y="5" width="70" height="20" fill={isActive ? "#3b82f6" : "#ffffff"} rx="4" stroke={isActive ? "#2563eb" : "#e2e8f0"} strokeWidth="1" className="drop-shadow-sm"/>
                          <text x="0" y="19" fontSize="11" fill={isActive ? "#ffffff" : "#334155"} textAnchor="middle" fontWeight="bold" className="pointer-events-none">
                             {s.name.length > 10 ? s.name.substring(0,8)+'...' : s.name}
                          </text>
                          
                          {/* Score Badge */}
                          <circle cx="30" cy="-5" r="12" fill="#fef08a" stroke="#eab308" strokeWidth="2" className="drop-shadow-sm"/>
                          <text x="30" y="-1" fontSize="10" fill="#854d0e" textAnchor="middle" fontWeight="bold">{s.score}</text>
                       </g>
                     );
                  })}
               </svg>
            </div>
          </div>
        </div>
      </div>

      {/* --- NÚT ÂM THANH --- */}
      <button 
        onClick={() => { if (isBgmPlaying) { bgmRef.current?.pause(); setIsBgmPlaying(false); } else { bgmRef.current?.play().catch(e=>console.log(e)); setIsBgmPlaying(true); } }} 
        className="fixed bottom-6 right-6 bg-white border border-slate-200 text-slate-700 px-4 py-3 rounded-full text-sm font-bold shadow-lg hover:shadow-xl transition-all z-40 flex items-center gap-2 hover:bg-slate-50"
      >
        {isBgmPlaying ? <Volume2 size={20} className="text-blue-500" /> : <VolumeX size={20} className="text-slate-400" />}
        <span className="hidden sm:inline">{isBgmPlaying ? 'Tắt nhạc' : 'Bật nhạc'}</span>
      </button>

      {/* --- MODAL TRẢ LỜI CÂU HỎI --- */}
      {activeQuestion && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
            <div className="bg-blue-600 p-6 flex justify-between items-center text-white shrink-0">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <span className="bg-white/20 px-3 py-1 rounded-lg">Câu {activeQuestion.displayNumber}</span>
              </h2>
              <div className="flex items-center gap-6">
                <div className={`text-3xl font-mono font-bold px-4 py-2 rounded-xl bg-black/20 flex items-center gap-2 ${timeLeft <= 3 ? 'text-red-300 animate-pulse' : 'text-yellow-300'}`}>
                  <Clock size={24} />
                  00:{timeLeft.toString().padStart(2, '0')}
                </div>
                <button onClick={closeQuestionModal} className="text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full">
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="p-8 overflow-y-auto flex-1">
              <div className="text-2xl text-slate-800 mb-10 min-h-[120px] flex items-center justify-center text-center font-medium bg-slate-50 rounded-2xl p-6 border border-slate-100">
                {activeQuestion.text}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeQuestion.options.map((option: string, index: number) => {
                  let btnClass = "bg-white border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-slate-700";
                  if (showResultFeedback) {
                    if (index === activeQuestion.correctOption) btnClass = "bg-green-500 border-green-600 text-white shadow-lg transform scale-[1.02]";
                    else btnClass = "bg-slate-100 border-slate-200 text-slate-400 opacity-60";
                  }
                  return (
                    <button 
                      key={index} 
                      disabled={!!showResultFeedback} 
                      onClick={() => handleAnswerSelection(index)} 
                      className={`p-5 rounded-2xl text-lg font-medium transition-all duration-200 text-left flex items-start gap-4 ${btnClass}`}
                    >
                      <span className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 font-bold text-sm ${showResultFeedback && index === activeQuestion.correctOption ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="pt-1">{option}</span>
                    </button>
                  );
                })}
              </div>

              {showResultFeedback && (
                <div className={`mt-8 text-center text-2xl font-bold p-4 rounded-2xl animate-in slide-in-from-bottom-4 ${showResultFeedback === 'correct' ? 'bg-green-50 text-green-600 border border-green-200' : 'bg-red-50 text-red-600 border border-red-200'}`}>
                  {showResultFeedback === 'correct' ? '🎉 CHÍNH XÁC! +10 Điểm 🎉' : '❌ SAI RỒI! ❌'}
                </div>
              )}
            </div>
            
            <div className="bg-slate-50 p-4 text-center text-slate-600 font-medium border-t border-slate-200 shrink-0 flex items-center justify-center gap-2">
              <span>Học sinh trả lời:</span>
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg font-bold text-lg">
                {students.find(s => s.id === activeStudentId)?.name || 'Chưa chọn'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL QUẢN LÝ DANH SÁCH CHUNG --- */}
      {showBatchInputModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center mb-6 shrink-0">
              <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <Users className="text-blue-600" /> Quản lý danh sách
              </h3>
              <button onClick={() => { setShowBatchInputModal(false); setBatchInputText(""); }} className="text-slate-400 hover:text-slate-600 bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6 shrink-0">
              <button onClick={() => { handleExportResults(); setShowBatchInputModal(false); }} className="bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 py-2.5 px-3 rounded-xl text-sm font-semibold transition-colors flex justify-center items-center gap-2">
                <Download size={16} /> Xuất JSON
              </button>
              <button onClick={() => { handleClearAllStudents(); setShowBatchInputModal(false); }} className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 py-2.5 px-3 rounded-xl text-sm font-semibold transition-colors flex justify-center items-center gap-2">
                <Trash2 size={16} /> Xóa tất cả
              </button>
            </div>

            <div className="relative mb-6 shrink-0">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
              <div className="relative flex justify-center"><span className="px-4 bg-white text-xs text-slate-500 font-medium uppercase tracking-wider">Thêm hàng loạt</span></div>
            </div>

            <p className="text-sm text-slate-600 mb-2 font-medium">Nhập danh sách tên (mỗi tên 1 dòng):</p>
            <textarea
              value={batchInputText}
              onChange={e => setBatchInputText(e.target.value)}
              className="w-full flex-1 min-h-[160px] border border-slate-300 rounded-xl p-4 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 mb-6 resize-none custom-scrollbar text-sm bg-slate-50"
              placeholder="Ví dụ:&#10;Nguyễn Văn A&#10;Trần Thị B"
            />
            <div className="flex justify-end gap-3 shrink-0">
              <button onClick={() => { setShowBatchInputModal(false); setBatchInputText(""); }} className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold text-slate-700 transition-colors">Hủy</button>
              <button onClick={handleSaveBatchInput} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white shadow-md transition-colors flex items-center gap-2">
                <Save size={16} /> Lưu danh sách
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL QUẢN LÝ CÂU HỎI --- */}
      {isManagementMode && (
        <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col animate-in fade-in duration-200">
          <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center shadow-sm shrink-0">
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <Settings className="text-blue-600" /> Ngân Hàng Câu Hỏi
            </h2>
            <button onClick={() => setIsManagementMode(false)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
              <X size={16} /> Đóng
            </button>
          </div>
          <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
            <div className="w-full md:w-[300px] border-r border-slate-200 overflow-y-auto bg-white custom-scrollbar p-4">
              <div className="grid grid-cols-4 md:grid-cols-1 gap-2">
                {[...questions].sort((a,b) => a.displayNumber - b.displayNumber).map(q => (
                  <button 
                    key={q.id} 
                    onClick={() => setEditingQuestion({...q})} 
                    className={`p-3 rounded-xl text-left text-sm transition-colors border ${
                      editingQuestion?.id === q.id 
                        ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold' 
                        : 'bg-white border-slate-100 hover:border-slate-300 text-slate-600'
                    }`}
                  >
                    Câu {q.displayNumber}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 p-6 md:p-10 overflow-y-auto bg-slate-50 custom-scrollbar">
              {editingQuestion ? (
                <form onSubmit={saveEditedQuestion} className="max-w-3xl mx-auto bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
                  <h3 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-lg text-lg">Câu {editingQuestion.displayNumber}</span>
                    Chỉnh sửa nội dung
                  </h3>
                  
                  <div className="mb-8">
                    <label className="block text-slate-700 font-bold mb-3 text-sm uppercase tracking-wider">Nội dung câu hỏi</label>
                    <textarea 
                      value={editingQuestion.text} 
                      onChange={e => setEditingQuestion({...editingQuestion, text: e.target.value})} 
                      className="w-full p-4 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none h-32 bg-slate-50 text-slate-800 resize-none" 
                      required 
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <label className="block text-slate-700 font-bold mb-2 text-sm uppercase tracking-wider">Các đáp án</label>
                    {editingQuestion.options.map((opt: string, idx: number) => (
                      <div key={idx} className={`flex items-center gap-4 p-3 rounded-2xl border transition-colors ${editingQuestion.correctOption === idx ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                        <span className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm shrink-0 ${editingQuestion.correctOption === idx ? 'bg-green-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <input 
                          type="text" 
                          value={opt} 
                          onChange={e => { const newOpts = [...editingQuestion.options]; newOpts[idx] = e.target.value; setEditingQuestion({...editingQuestion, options: newOpts}); }} 
                          className="flex-1 p-2 bg-transparent outline-none text-slate-800" 
                          required 
                        />
                        <label className="flex items-center gap-2 cursor-pointer shrink-0 px-3 py-2 rounded-xl hover:bg-slate-100 transition-colors">
                          <input 
                            type="radio" 
                            name="correctAnswer" 
                            checked={editingQuestion.correctOption === idx} 
                            onChange={() => setEditingQuestion({...editingQuestion, correctOption: idx})} 
                            className="w-5 h-5 text-green-600 focus:ring-green-500 border-slate-300" 
                          />
                          <span className={`text-sm font-bold ${editingQuestion.correctOption === idx ? 'text-green-700' : 'text-slate-500'}`}>Đáp án đúng</span>
                        </label>
                      </div>
                    ))}
                  </div>
                  
                  <div className="pt-8 mt-8 border-t border-slate-100 flex justify-end gap-3">
                    <button type="button" onClick={() => setEditingQuestion(null)} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">Hủy</button>
                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-md transition-colors flex items-center gap-2">
                      <Save size={18} /> Lưu Thay Đổi
                    </button>
                  </div>
                </form>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                  <Settings size={48} className="opacity-20" />
                  <p className="text-lg font-medium">Chọn một câu hỏi ở danh sách bên trái để chỉnh sửa</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- CUSTOM MODALS --- */}
      {addClassModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-slate-800 mb-4">Thêm lớp mới</h3>
            <input 
              type="text" 
              autoFocus
              placeholder="Nhập tên lớp..." 
              value={newClassNameInput}
              onChange={(e) => setNewClassNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmAddClass()}
              className="w-full px-4 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setAddClassModalOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold text-slate-700 transition-colors">Hủy</button>
              <button onClick={confirmAddClass} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-sm transition-colors">Thêm lớp</button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-slate-800 mb-2">{confirmDialog.title}</h3>
            <p className="text-slate-600 mb-6">{confirmDialog.message}</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl font-semibold text-slate-700 transition-colors">Hủy</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog({ ...confirmDialog, isOpen: false }); }} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold shadow-sm transition-colors">Xác nhận</button>
            </div>
          </div>
        </div>
      )}

      {alertDialog.isOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <h3 className="text-xl font-bold text-slate-800 mb-2">{alertDialog.title}</h3>
            <p className="text-slate-600 mb-6">{alertDialog.message}</p>
            <div className="flex justify-end">
              <button onClick={() => setAlertDialog({ ...alertDialog, isOpen: false })} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold shadow-sm transition-colors">Đóng</button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
      `}} />
    </div>
  );
}
