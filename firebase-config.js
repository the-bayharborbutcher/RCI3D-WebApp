// Firebase Configuration - CORRECT VERSION for your setup
const firebaseConfig = {
  apiKey: "AIzaSyDuAj3H2TWWCXeNA3l5tgp8GsVEty-iA5U",
  authDomain: "rci3d-app-2026.firebaseapp.com",
  databaseURL: "https://rci3d-app-2026-default-rtdb.firebaseio.com",
  projectId: "rci3d-app-2026",
  storageBucket: "rci3d-app-2026.firebasestorage.app",
  messagingSenderId: "644754020546",
  appId: "1:644754020546:web:4c86939af6bef54e09035b",
  measurementId: "G-MG0WVB6JVD"
};

// Initialize Firebase (using the compatibility version)
firebase.initializeApp(firebaseConfig);

// Make auth and database available globally
const auth = firebase.auth();
const database = firebase.database();

// Attach to window for global access
window.auth = auth;
window.database = database;

console.log('✅ Firebase initialized successfully');
console.log('✅ Auth object:', auth ? 'Available' : 'Not available');
console.log('✅ Database object:', database ? 'Available' : 'Not available');

// Test authentication connection
auth.onAuthStateChanged((user) => {
    console.log('Auth state check:', user ? '✅ User logged in' : '❌ No user');
});