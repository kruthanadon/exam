const API_URL = "https://script.google.com/macros/s/AKfycbygJE90BMEPD2HwLkbMGYF8z_raFAYV5fNre_AODSy9Irnl0fSvXKXrKbUJYOpBLqURlA/exec";

let selectedExam = "";
let currentEmail = "";
let lastCheatTime = 0; // ตัวแปรป้องกันการนับซ้ำ (Debounce)
let isAntiCheatInitialized = false;

window.onload = function() {
    checkLockStatus();

    // 1. กด Enter ในช่อง Email ให้เรียก handleVerifyEmail()
    document.getElementById('input-email')?.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault(); // ป้องกันหน้าเว็บ Refresh
            handleVerifyEmail();
        }
    });

    // 2. กด Enter ในช่อง รหัสผ่านครู ให้เรียก handleUnlock()
    document.getElementById('teacher-password')?.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            handleUnlock();
        }
    });
};

// ==========================================
// 🚀 Helper: Fetch พร้อมระบบ Timeout และ Retry เมื่อ GAS ตอบช้า
// ==========================================
async function fetchWithRetry(url, options = {}, retries = 2, backoff = 1000) {
    for (let i = 0; i <= retries; i++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // Timeout ที่ 8 วินาที

            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();

        } catch (err) {
            console.warn(`Attempt ${i + 1} failed:`, err.message);
            if (i === retries) throw err;
            await new Promise(res => setTimeout(res, backoff * (i + 1)));
        }
    }
}

// ตรวจสอบสถานะการล็อกตอนเปิดหน้าเว็บ
function checkLockStatus() {
    const isLocked = localStorage.getItem("isLocked");
    if (isLocked === "true") {
        selectedExam = localStorage.getItem("currentExam") || "";
        showLockScreen();
    } else {
        localStorage.removeItem("currentExam");
        localStorage.removeItem("formUrl");
        localStorage.removeItem("cheatCount");
        
        fetchActiveExams();
    }
}

// 1. ดึงรายชื่อวิชาทั้งหมด (พร้อมระบบ Frontend Cache ชั่วคราว)
async function fetchActiveExams() {
    const cachedExams = localStorage.getItem("cached_exam_list");
    
    // แสดงผลข้อมูลจาก Cache ก่อนทันทีหากมี (ไม่หมุนค้าง)
    if (cachedExams) {
        populateExamDropdown(JSON.parse(cachedExams));
        switchView('view-login');
    } else {
        switchView('view-loading');
    }

    try {
        const result = await fetchWithRetry(`${API_URL}?action=getExams`);
        if (result.status === "success" && result.data.length > 0) {
            localStorage.setItem("cached_exam_list", JSON.stringify(result.data));
            populateExamDropdown(result.data);
            switchView('view-login');
        }
    } catch (error) {
        console.error("Fetch Exams Error:", error);
        if (!cachedExams) {
            alert("ไม่สามารถดึงข้อมูลข้อสอบได้ กรุณารีเฟรชหน้าเว็บอีกครั้ง");
        }
    }
}

function populateExamDropdown(exams) {
    const selectElement = document.getElementById('select-exam');
    if (!selectElement) return;

    const currentValue = selectElement.value;
    selectElement.innerHTML = '<option value="">-- กรุณาเลือกวิชาสอบ --</option>';
    
    exams.forEach(exam => {
        const option = document.createElement('option');
        option.value = exam;
        option.textContent = exam;
        selectElement.appendChild(option);
    });

    if (currentValue) selectElement.value = currentValue;
}

// 2. ตรวจสอบสิทธิ์อีเมลและวิชาสอบ
async function handleVerifyEmail() {
    const emailInput = document.getElementById('input-email').value.trim().toLowerCase();
    const examInput = document.getElementById('select-exam').value;

    if (!examInput) return alert("กรุณาเลือกวิชาสอบ");
    if (!emailInput) return alert("กรุณากรอก Email");

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(emailInput)) {
        return alert("❌ รูปแบบ Email ไม่ถูกต้อง! กรุณาตรวจสอบอีกครั้ง (เช่น 28228@blm.ac.th)");
    }

    if (!emailInput.endsWith("@blm.ac.th")) {
        return alert("❌ ระบบอนุญาตให้ใช้เฉพาะ Email ของสถาบัน (@blm.ac.th) เท่านั้น!");
    }

    currentEmail = emailInput;
    selectedExam = examInput;

    try {
        switchView('view-loading');
        const result = await fetchWithRetry(`${API_URL}?action=checkEmail&email=${encodeURIComponent(currentEmail)}&exam=${encodeURIComponent(selectedExam)}`);

        if (result.hasTaken) {
            switchView('view-already-taken');
        } else {
            await registerExam(currentEmail, selectedExam);
        }
    } catch (error) {
        console.error(error);
        alert("เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์ กรุณาลองใหม่อีกครั้ง");
        switchView('view-login');
    }
}

// 3. ลงทะเบียนและรับลิงก์ทำข้อสอบ (ส่งแบบ text/plain เพื่อตัดปัญหา CORS OPTIONS)
async function registerExam(email, exam) {
    try {
        const result = await fetchWithRetry(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'register', email: email, exam: exam })
        });

        if (result.status === "success") {
            localStorage.setItem("currentExam", exam);
            localStorage.setItem("formUrl", result.formUrl);
            if (!localStorage.getItem("cheatCount")) localStorage.setItem("cheatCount", "0");

            document.getElementById('exam-iframe').src = result.formUrl;
            switchView('view-exam');
            initAntiCheat();
        } else {
            alert(result.message);
            switchView('view-login');
        }
    } catch (error) {
        console.error(error);
        alert("ระบบบันทึกข้อมูลขัดข้อง กรุณาลองใหม่อีกครั้ง");
        switchView('view-login');
    }
}

// 4. ระบบตรวจจับการทุจริต (แก้ไขป้องกันการนับเบิ้ลด้วย Debounce 1.5 วินาที)
function initAntiCheat() {
    function triggerCheatCounter() {
        if (document.getElementById('view-exam').classList.contains('hidden')) return;

        // 🛑 ป้องกันการทำงานซ้ำซ้อนภายใน 1.5 วินาที (แก้ปัญหานับเบิ้ลจาก blur + visibilitychange)
        const now = Date.now();
        if (now - lastCheatTime < 1500) return;
        lastCheatTime = now;

        let count = parseInt(localStorage.getItem("cheatCount")) || 0;
        count++;
        localStorage.setItem("cheatCount", count.toString());

        if (count >= 4) {
            localStorage.setItem("isLocked", "true");
            showLockScreen();
        } else {
            alert(`⚠️ คำเตือน: คุณออกนอกหน้าจอสอบแล้วจำนวน ${count-1} ครั้ง หากถึง 3 ครั้งระบบจะทำการล็อก!`);
        }
    }

    // ผูก Event Listener เพียงครั้งเดียวเท่านั้น
    if (!isAntiCheatInitialized) {
        window.onblur = triggerCheatCounter;
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) triggerCheatCounter();
        });
        isAntiCheatInitialized = true;
    }
}

function showLockScreen() {
    const count = localStorage.getItem("cheatCount") || 4;
    document.getElementById('lock-message').innerText = `คุณทุจริตการสอบเนื่องจากออกจากหน้าสอบวิชา [${selectedExam}] จำนวน ${count-1} ครั้ง`;
    switchView('view-lock');
}

// 5. ปลดล็อกรหัสผ่านครู
async function handleUnlock() {
    const passwordInput = document.getElementById('teacher-password').value;
    if (!passwordInput) return alert("กรุณากรอกรหัสผ่าน");

    // ⚠️ ข้อแนะนำ: ควรย้ายรหัส Admin ไปตรวจที่หลังบ้าน แต่คงไว้ให้ใช้งานฉุกเฉิน
    if (passwordInput === "admin1234") {
        localStorage.setItem("isLocked", "false");
        localStorage.setItem("cheatCount", "0");
        document.getElementById('teacher-password').value = "";
        alert("🔓 Admin Reset เรียบร้อยแล้ว ระบบกำลังกลับสู่หน้าหลัก");
        fetchActiveExams();
        return;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'verifyPassword', exam: selectedExam, password: passwordInput })
        });
        const result = await response.json();

        if (result.status === "success" && result.valid === true) {
            localStorage.setItem("isLocked", "false");
            localStorage.setItem("cheatCount", "0");
            document.getElementById('teacher-password').value = "";
            
            const savedFormUrl = localStorage.getItem("formUrl");
            if (savedFormUrl) {
                document.getElementById('exam-iframe').src = savedFormUrl;
            }
            
            switchView('view-exam'); 
        } else {
            alert("รหัสผ่านของวิชานี้ไม่ถูกต้อง!");
        }
    } catch (error) {
        console.error(error);
        alert("ไม่สามารถตรวจสอบรหัสผ่านได้ในขณะนี้");
    }
}

function switchView(viewId) {
    const views = ['view-loading', 'view-login', 'view-already-taken', 'view-exam', 'view-lock'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');
}
