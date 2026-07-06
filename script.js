const API_URL = "https://script.google.com/macros/s/AKfycbygJE90BMEPD2HwLkbMGYF8z_raFAYV5fNre_AODSy9Irnl0fSvXKXrKbUJYOpBLqURlA/exec";

let selectedExam = "";
let currentEmail = "";

window.onload = function() {
    checkLockStatus();
};

// [จุดที่ 3] อัปเดตฟังก์ชัน checkLockStatus เดิม
function checkLockStatus() {
    const isLocked = localStorage.getItem("isLocked");
    if (isLocked === "true") {
        selectedExam = localStorage.getItem("currentExam") || "";
        showLockScreen();
    } else {
        // ⭐ เพิ่มบรรทัดนี้: ถ้าไม่ได้ถูกล็อกอยู่ และไม่ได้อยู่ในหน้าสอบ ให้เคลียร์ประวัติเก่าทิ้งเพื่อเตรียมสอบวิชาใหม่
        localStorage.removeItem("currentExam");
        localStorage.removeItem("formUrl");
        localStorage.removeItem("cheatCount");
        
        fetchActiveExams();
    }
}

// 1. ดึงรายชื่อวิชาทั้งหมดจากตาราง Exams ใน Sheet มาใส่ตาราง Dropdown
async function fetchActiveExams() {
  try {
      switchView('view-loading');
      const response = await fetch(`${API_URL}?action=getExams`);
      const result = await response.json();
      
      if (result.status === "success") {
          const selectElement = document.getElementById('select-exam');
          selectElement.innerHTML = '<option value="">-- กรุณาเลือกวิชาสอบ --</option>';
          
          result.data.forEach(exam => {
              const option = document.createElement('option');
              option.value = exam;
              option.textContent = exam;
              selectElement.appendChild(option);
          });
          switchView('view-login');
      } else {
          alert("ไม่สามารถดึงข้อมูลข้อสอบได้");
      }
  } catch (error) {
      console.error(error);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล");
  }
}

// 2. ตรวจสอบสิทธิ์อีเมลและวิชาสอบ
async function handleVerifyEmail() {
    const emailInput = document.getElementById('input-email').value.trim().toLowerCase();
    const examInput = document.getElementById('select-exam').value;

    if (!examInput) return alert("กรุณาเลือกวิชาสอบ");
    if (!emailInput) return alert("กรุณากรอก Email");

    currentEmail = emailInput;
    selectedExam = examInput;

    try {
        switchView('view-loading');
        // เรียกตรวจสอบฝั่ง Server ว่าคู่อีเมล+วิชานี้เคยมีประวัติการสอบหรือยัง
        const response = await fetch(`${API_URL}?action=checkEmail&email=${encodeURIComponent(currentEmail)}&exam=${encodeURIComponent(selectedExam)}`);
        const result = await response.json();

        if (result.hasTaken) {
            switchView('view-already-taken');
        } else {
            // บันทึกสิทธิ์และรับ Secure ลิงก์ Google Form กลับมา
            await registerExam(currentEmail, selectedExam);
        }
    } catch (error) {
        console.error(error);
        alert("เกิดข้อผิดพลาดในการตรวจสอบสิทธิ์");
        switchView('view-login');
    }
}

// 3. ลงทะเบียนและรับลิงก์ทำข้อสอบ
// [จุดที่ 1] อัปเดตในฟังก์ชัน registerExam เดิม
async function registerExam(email, exam) {
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'register', email: email, exam: exam })
        });
        const result = await response.json();

        if (result.status === "success") {
            // เซฟสถานะลง LocalStorage
            localStorage.setItem("currentExam", exam);
            localStorage.setItem("formUrl", result.formUrl); // ⭐ เพิ่มบรรทัดนี้: จำลิงก์ข้อสอบไว้
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
        alert("ระบบบันทึกข้อมูลขัดข้อง");
        switchView('view-login');
    }
}

// 4. ระบบตรวจจับการทุจริต (ผสมผสานทั้ง Blur และ VisibilityChange เพื่อความแม่นยำ)
function initAntiCheat() {
    function triggerCheatCounter() {
        if (document.getElementById('view-exam').classList.contains('hidden')) return;

        let count = parseInt(localStorage.getItem("cheatCount")) || 0;
        count++;
        localStorage.setItem("cheatCount", count.toString());

        alert(`⚠️ คำเตือน: คุณออกนอกหน้าจอสอบแล้วจำนวน ${count} ครั้ง หากเกิน 3 ครั้งระบบจะทำการล็อก!`);

        if (count >= 3) {
            localStorage.setItem("isLocked", "true");
            showLockScreen();
        }
    }

    // ตรวจจับเมื่อผู้สอบคลิกออกไปนอก Browser หรือเปิดโปรแกรมอื่นบังหน้าจอ
    window.onblur = triggerCheatCounter;

    // ตรวจจับเมื่อเปลี่ยนแท็บ หรือ ย่อหน้าต่างลง (Visibility API)
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            triggerCheatCounter();
        }
    });
}

function showLockScreen() {
    const count = localStorage.getItem("cheatCount") || 3;
    document.getElementById('lock-message').innerText = `คุณทุจริตการสอบเนื่องจากออกจากหน้าสอบวิชา [${selectedExam}] จำนวน ${count} ครั้ง`;
    switchView('view-lock');
}

// 5. ส่งรหัสผ่านไปตรวจที่หลังบ้าน (Server-side Password Verification)
// [จุดที่ 2] อัปเดตฟังก์ชัน handleUnlock ใหม่ทั้งหมดแทนของเดิม
async function handleUnlock() {
    const passwordInput = document.getElementById('teacher-password').value;
    if (!passwordInput) return alert("กรุณากรอกรหัสผ่าน");

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: 'verifyPassword', exam: selectedExam, password: passwordInput })
        });
        const result = await response.json();

        if (result.status === "success" && result.valid === true) {
            // 1. ปลดล็อกระบบ และรีเซ็ตแต้มโกงให้เริ่มนับ 0 ใหม่ (ให้โอกาสแก้ตัว)
            localStorage.setItem("isLocked", "false");
            localStorage.setItem("cheatCount", "0");
            document.getElementById('teacher-password').value = "";
            
            // 2. ดึงลิงก์ข้อสอบเดิมที่เซฟไว้กลับมาใส่ใน iframe 
            // (ช่วยแก้ปัญหาเด็กกด Refresh หน้าจอตอนติดล็อกได้อย่างสมบูรณ์แบบ)
            const savedFormUrl = localStorage.getItem("formUrl");
            if (savedFormUrl) {
                document.getElementById('exam-iframe').src = savedFormUrl;
            }
            
            // 3. พานักเรียนกลับเข้าหน้าสอบทันที ไม่ต้องผ่านหน้าล็อกอินแล้ว!
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
    views.forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}
