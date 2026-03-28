// --- CONFIGURATION ---
const GEMINI_API_KEY = "YOUR_GEMINI_API_KEY"; 
const SHEET_NAME = "Users";
const SHEET_QR = "QRCodes";
const SHEET_HISTORY = "History";
const SHEET_SETTINGS = "Settings";
const FOLDER_NAME = "BarberApp_UserImages"; 
const ADMIN_EMAILS = [
  "krutrit@gmail.com", 
  "owner@gmail.com" 
]; 

// =======================================================
// === ฟังก์ชัน Helper สำหรับแปลง Data เป็น TSV String (Hybrid Data Transfer) ===
function convertToTSV(dataArray, keys) {
  if (!dataArray || dataArray.length === 0) return '';
  const header = keys.join('\t');
  const rows = dataArray.map(obj => {
    return keys.map(k => {
      let val = (obj[k] !== undefined && obj[k] !== null) ? String(obj[k]) : '';
      return val.replace(/\t|\n|\r/g, ' '); // กันพัง: แทนที่ Tab/Newline ในข้อมูลด้วยช่องว่าง
    }).join('\t');
  });
  return [header, ...rows].join('\n');
}
// =======================================================

// --- WEB APP SETUP ---
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('แก่นจำปาบาร์เบอร์ | ระบบสมาชิก')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) { return HtmlService.createHtmlOutputFromFile(filename).getContent(); }

// --- DATABASE LOGIC ---
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === SHEET_NAME) {
      sheet.appendRow(["UID", "Name", "Email", "Password", "Points", "PhotoURL", "LastActive", "PhoneNumber", "CoverURL"]);
      sheet.setFrozenRows(1);
    } else if (name === SHEET_QR) {
      sheet.appendRow(["Code", "Status", "CreatedAt"]);
    } else if (name === SHEET_HISTORY) {
      sheet.appendRow(["Timestamp", "Date", "Time", "UserName", "UserEmail", "Action"]);
      sheet.setFrozenRows(1);
    } else if (name === SHEET_SETTINGS) {
      sheet.appendRow(["Key", "Value"]);
    }
  }
  return sheet;
}

function hashPassword(password) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password));
}

function saveFileToDrive(base64Data, fileName) {
  try {
    const folders = DriveApp.getFoldersByName(FOLDER_NAME);
    let folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
    const contentType = base64Data.split(',')[0].split(':')[1].split(';')[0];
    const decoded = Utilities.base64Decode(base64Data.split(',')[1]);
    const blob = Utilities.newBlob(decoded, contentType, fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    if (contentType.startsWith('image/')) {
        return "https://drive.google.com/thumbnail?sz=w1000&id=" + file.getId();
    } else {
        return "https://drive.google.com/uc?export=download&id=" + file.getId();
    }
  } catch (e) {
    throw new Error("Upload Failed: " + e.toString());
  }
}

// --- SETTINGS ---
function getAppSettings() {
  const sheet = getSheet(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const settings = { stampSound: "", winSound: "" };
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    if (settings.hasOwnProperty(key)) settings[key] = data[i][1];
  }
  return settings;
}

function saveAppSettings(form) {
  const sheet = getSheet(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const updateOrAdd = (key, value) => {
    let found = false;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === key) { sheet.getRange(i + 1, 2).setValue(value); found = true; break; }
    }
    if (!found) sheet.appendRow([key, value]);
  };
  if (form.newStampSoundBase64) updateOrAdd("stampSound", saveFileToDrive(form.newStampSoundBase64, "stamp_" + Date.now() + ".mp3"));
  else if (form.stampSoundDefault) updateOrAdd("stampSound", "");
  if (form.newWinSoundBase64) updateOrAdd("winSound", saveFileToDrive(form.newWinSoundBase64, "win_" + Date.now() + ".mp3"));
  else if (form.winSoundDefault) updateOrAdd("winSound", "");
  return { success: true, message: "บันทึกเรียบร้อย" };
}

// --- AUTH ---
function doRegister(form) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] == form.email) throw new Error("อีเมลนี้ถูกใช้งานแล้ว");
  }
  const newUid = Utilities.getUuid();
  const photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(form.name)}&background=d4af37&color=000`;
  const passwordHash = hashPassword(form.password);
  sheet.appendRow([newUid, form.name, form.email, passwordHash, 0, photoUrl, new Date(), "'" + (form.phoneNumber || ""), ""]);
  return { uid: newUid, name: form.name, email: form.email, points: 0, photo: photoUrl, phoneNumber: form.phoneNumber || "", cover: "", isAdmin: ADMIN_EMAILS.includes(form.email) };
}

function doLogin(form) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const loginHash = hashPassword(form.password);
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] == form.email && data[i][3] == loginHash) {
      sheet.getRange(i + 1, 7).setValue(new Date()); 
      return {
        uid: data[i][0], name: data[i][1], email: data[i][2], points: parseInt(data[i][4]), photo: data[i][5], phoneNumber: data[i][7] || "", cover: data[i][8] || "", isAdmin: ADMIN_EMAILS.includes(data[i][2])
      };
    }
  }
  throw new Error("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
}

function getUserData(uid) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == uid) {
      return { uid: data[i][0], name: data[i][1], email: data[i][2], points: parseInt(data[i][4]), photo: data[i][5], phoneNumber: data[i][7] || "", cover: data[i][8] || "", isAdmin: ADMIN_EMAILS.includes(data[i][2]) };
    }
  }
  throw new Error("ไม่พบข้อมูล");
}

function userUpdateProfile(form) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  if (form.email) {
    for (let i = 1; i < data.length; i++) {
      if (data[i][2] == form.email && data[i][0] != form.uid) throw new Error("อีเมลซ้ำ");
    }
  }
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == form.uid) { 
      const row = i + 1;
      sheet.getRange(row, 2).setValue(form.name);
      sheet.getRange(row, 8).setValue("'" + form.phoneNumber);
      if (form.email) sheet.getRange(row, 3).setValue(form.email);
      if (form.newPhotoBase64) sheet.getRange(row, 6).setValue(saveFileToDrive(form.newPhotoBase64, form.uid + "_p_" + Date.now() + ".jpg"));
      if (form.newCoverBase64) sheet.getRange(row, 9).setValue(saveFileToDrive(form.newCoverBase64, form.uid + "_c_" + Date.now() + ".jpg"));
      if (form.newPassword) sheet.getRange(row, 4).setValue(hashPassword(form.newPassword));
      return { success: true };
    }
  }
  throw new Error("ไม่พบผู้ใช้");
}

// --- QR & HISTORY ---
function generateOneTimeQR() {
  const sheet = getSheet(SHEET_QR);
  const code = Utilities.getUuid();
  sheet.appendRow([code, "ACTIVE", new Date()]);
  return code;
}

function scanQRCode(uid, qrCode) {
  const qrSheet = getSheet(SHEET_QR);
  const userSheet = getSheet(SHEET_NAME);
  const histSheet = getSheet(SHEET_HISTORY);
  
  const qrData = qrSheet.getDataRange().getValues();
  let qrRow = -1;
  for (let i = 1; i < qrData.length; i++) {
    if (qrData[i][0] == qrCode && qrData[i][1] == "ACTIVE") { qrRow = i + 1; break; }
  }
  if (qrRow == -1) throw new Error("QR Code ไม่ถูกต้องหรือถูกใช้แล้ว");
  
  const userData = userSheet.getDataRange().getValues();
  let uRow = -1, curPoints = 0, uName = "", uEmail = "";
  for (let i = 1; i < userData.length; i++) {
    if (userData[i][0] == uid) { uRow = i + 1; curPoints = parseInt(userData[i][4]); uName = userData[i][1]; uEmail = userData[i][2]; break; }
  }
  if (uRow == -1) throw new Error("ไม่พบผู้ใช้");
  if (curPoints >= 5) throw new Error("แต้มเต็มแล้ว");
  
  const newPoints = curPoints + 1;
  qrSheet.getRange(qrRow, 2).setValue("USED");
  userSheet.getRange(uRow, 5).setValue(newPoints);
  
  const now = new Date();
  histSheet.appendRow([now, Utilities.formatDate(now, "GMT+7", "dd/MM/yyyy"), Utilities.formatDate(now, "GMT+7", "HH:mm:ss"), uName, uEmail, "ได้รับ 1 แต้ม"]);
  return newPoints;
}

function getScanHistory() {
  const sheet = getSheet(SHEET_HISTORY);
  const data = sheet.getDataRange().getDisplayValues(); 
  const history = [];
  // เพิ่ม Limit เป็น 500 เพื่อให้ครอบคลุมการกรองแบบเดือน
  for (let i = data.length - 1; i >= 1; i--) {
    if (history.length >= 500) break; 
    history.push({ 
      rowIndex: i + 1, 
      date: data[i][1], 
      time: data[i][2], 
      name: data[i][3], 
      action: data[i][5] 
    });
  }
  // คืนค่าเป็น TSV
  return convertToTSV(history, ['rowIndex', 'date', 'time', 'name', 'action']);
}

function adminDeleteHistoryItems(rowIndices) {
  const sheet = getSheet(SHEET_HISTORY);
  rowIndices.sort((a, b) => b - a);
  rowIndices.forEach(row => {
    try { sheet.deleteRow(row); } catch(e) {}
  });
  return { success: true };
}

// --- ADMIN USERS ---
function getAllUsersAdmin() {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    users.push({ rowIndex: i + 1, uid: data[i][0], name: data[i][1], email: data[i][2], points: data[i][4], photo: data[i][5], phoneNumber: data[i][7] || "", isAdmin: ADMIN_EMAILS.includes(data[i][2]) });
  }
  // คืนค่าเป็น TSV
  return convertToTSV(users, ['rowIndex', 'uid', 'name', 'email', 'points', 'photo', 'phoneNumber', 'isAdmin']);
}

function adminSaveUser(form) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][2] == form.email && (!form.uid || data[i][0] != form.uid)) throw new Error("อีเมลซ้ำ");
  }
  if (!form.uid) { 
    const newUid = Utilities.getUuid();
    const photoUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(form.name)}&background=d4af37&color=000`;
    sheet.appendRow([newUid, form.name, form.email, hashPassword(form.password || "1234"), parseInt(form.points)||0, photoUrl, new Date(), "'" + form.phoneNumber, ""]);
    return { success: true, message: "เพิ่มสำเร็จ" };
  } else {
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == form.uid) {
        const row = i + 1;
        sheet.getRange(row, 2).setValue(form.name);
        sheet.getRange(row, 3).setValue(form.email);
        sheet.getRange(row, 5).setValue(parseInt(form.points));
        sheet.getRange(row, 8).setValue("'" + form.phoneNumber);
        if (form.password) sheet.getRange(row, 4).setValue(hashPassword(form.password));
        return { success: true, message: "อัปเดตสำเร็จ" };
      }
    }
    throw new Error("ไม่พบผู้ใช้");
  }
}

function adminDeleteUser(uid) {
  const sheet = getSheet(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] == uid) { sheet.deleteRow(i + 1); return { success: true }; }
  }
  throw new Error("ไม่พบผู้ใช้");
}

function callGeminiAI(prompt) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "YOUR_GEMINI_API_KEY") return "Error: API Key";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };
  try {
    const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    return JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
  } catch (e) { return "Error: " + e.toString(); }
}

// =======================================================
// 5. API สำหรับรองรับ Localhost / โหมด Dev / Server (doPost)
// =======================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const payload = data.payload;
    let result;

    switch(action) {
      case 'getAppSettings': result = getAppSettings(); break;
      case 'saveAppSettings': result = saveAppSettings(payload); break;
      case 'doRegister': result = doRegister(payload); break;
      case 'doLogin': result = doLogin(payload); break;
      case 'getUserData': result = getUserData(payload); break;
      case 'userUpdateProfile': result = userUpdateProfile(payload); break;
      case 'generateOneTimeQR': result = generateOneTimeQR(); break;
      case 'scanQRCode': result = scanQRCode(payload.uid, payload.qrCode); break;
      case 'getScanHistory': result = getScanHistory(); break; // คืนค่าเป็น TSV
      case 'adminDeleteHistoryItems': result = adminDeleteHistoryItems(payload); break;
      case 'getAllUsersAdmin': result = getAllUsersAdmin(); break; // คืนค่าเป็น TSV
      case 'adminSaveUser': result = adminSaveUser(payload); break;
      case 'adminDeleteUser': result = adminDeleteUser(payload); break;
      default: throw new Error('Unknown action');
    }
    // ห่อหุ้มโครงสร้างเป็นแบบมาตรฐาน ({success: true, data: result})
    return ContentService.createTextOutput(JSON.stringify({success: true, data: result})).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    // ดักจับ Error จาก Backend แล้วส่งไปยัง Frontend
    return ContentService.createTextOutput(JSON.stringify({success: false, error: error.toString().replace('Error: ', '')})).setMimeType(ContentService.MimeType.JSON);
  }
}