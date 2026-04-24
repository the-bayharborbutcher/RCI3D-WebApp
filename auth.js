// ============================================
// RCI3D - AUTH MODULE (Fixed)
// ============================================

console.log('Auth.js loading...');

let currentUser = null;

// ============================================
// NOTIFICATION SYSTEM (defined here so auth can use it)
// ============================================

function showNotification(message, type = 'info') {
    const container = document.getElementById('notificationContainer');
    if (!container) return;

    const notif = document.createElement('div');
    notif.className = `notification ${type}`;
    notif.textContent = message;
    container.appendChild(notif);

    setTimeout(() => {
        notif.style.opacity = '0';
        notif.style.transition = 'opacity 0.4s';
        setTimeout(() => notif.remove(), 400);
    }, 3500);
}

// ============================================
// FIREBASE READY CHECK
// ============================================

function checkFirebaseReady() {
    if (typeof auth === 'undefined' || !auth) {
        console.error('❌ auth is not defined');
        showNotification('Firebase connection error. Please refresh.', 'error');
        return false;
    }
    return true;
}

// ============================================
// AUTH STATE LISTENER
// ============================================

// Wait for DOM + Firebase to be ready
window.addEventListener('load', function() {
    if (!checkFirebaseReady()) return;

    auth.onAuthStateChanged((user) => {
        console.log('Auth state changed:', user ? '✅ Logged in: ' + user.email : '❌ Logged out');

        if (user) {
            currentUser = user;
            window.currentUser = user; // Make available globally for script.js
            showApp();
            loadUserData(user);
            // startRealTimeUpdates called after app shows
            if (typeof startRealTimeUpdates === 'function') {
                startRealTimeUpdates();
            }
            // Load saved language + temp unit preferences
            if (typeof loadUserPreferences === 'function') {
                setTimeout(loadUserPreferences, 500); // after DOM is ready
            }
            showNotification(`Welcome back, ${user.displayName || user.email}!`, 'success');
        } else {
            currentUser = null;
            window.currentUser = null;
            showLogin();
        }
    });
});

// ============================================
// SHOW/HIDE SCREENS
// ============================================

function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

function showApp() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
}

// ============================================
// LOAD USER DATA INTO UI
// ============================================

function loadUserData(user) {
    const userNameEl  = document.getElementById('userName');
    const userEmailEl = document.getElementById('userEmail');
    const userAvatarEl = document.getElementById('userAvatar');

    if (userNameEl)  userNameEl.textContent  = user.displayName || 'User';
    if (userEmailEl) userEmailEl.textContent = user.email;

    if (userAvatarEl) {
        if (user.photoURL) {
            userAvatarEl.src = user.photoURL;
        } else {
            const name = encodeURIComponent(user.displayName || 'User');
            userAvatarEl.src = `https://ui-avatars.com/api/?name=${name}&background=667eea&color=fff&size=80`;
        }
    }

    // Load printers from Firebase
    if (typeof database !== 'undefined' && database) {
        database.ref(`users/${user.uid}/printers`).once('value')
            .then((snapshot) => {
                const printers = snapshot.val();
                if (printers && typeof updatePrinterSelector === 'function') {
                    updatePrinterSelector(printers);
                }
            })
            .catch(err => console.error('Error loading printers:', err));
    }
}

// ============================================
// FORGOT PASSWORD
// ============================================

function showForgotPassword(e) {
    e && e.preventDefault();
    const modal = document.getElementById('forgotModal');
    if (modal) { modal.style.display = 'flex'; }
    const inp = document.getElementById('resetEmail');
    if (inp) {
        const email = document.getElementById('loginEmail');
        if (email && email.value) inp.value = email.value;
        setTimeout(() => inp.focus(), 100);
    }
}

function closeForgotModal() {
    const modal = document.getElementById('forgotModal');
    if (modal) modal.style.display = 'none';
}

async function sendResetEmail() {
    if (!checkFirebaseReady()) return;
    const email = (document.getElementById('resetEmail') || {}).value;
    if (!email || !email.trim()) {
        showNotification('Entrez votre adresse email.', 'error');
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email.trim());
        showNotification('Email de réinitialisation envoyé !', 'success');
        closeForgotModal();
    } catch (error) {
        console.error('Reset error:', error);
        showNotification(getAuthErrorMessage(error.code), 'error');
    }
}

// ============================================
// SIGNUP MODAL
// ============================================

function showSignupModal(e) {
    e && e.preventDefault();
    const modal = document.getElementById('signupModal');
    if (modal) modal.style.display = 'flex';
}

function closeSignupModal() {
    const modal = document.getElementById('signupModal');
    if (modal) modal.style.display = 'none';
}

async function handleSignup(e) {
    e.preventDefault();
    if (!checkFirebaseReady()) return;

    const name     = (document.getElementById('signupName') || {}).value.trim();
    const email    = (document.getElementById('signupEmail') || {}).value.trim();
    const password = (document.getElementById('signupPassword') || {}).value;

    if (password.length < 6) {
        showNotification('Le mot de passe doit contenir au moins 6 caractères.', 'error');
        return;
    }
    try {
        showNotification('Création du compte...', 'info');
        const result = await auth.createUserWithEmailAndPassword(email, password);
        await result.user.updateProfile({ displayName: name });
        if (typeof database !== 'undefined' && database) {
            await database.ref(`users/${result.user.uid}`).set({
                name, email,
                createdAt: firebase.database.ServerValue.TIMESTAMP,
                printers: {}
            });
        }
        closeSignupModal();
        showNotification('Compte créé avec succès !', 'success');
    } catch (error) {
        console.error('Signup error:', error);
        showNotification(getAuthErrorMessage(error.code), 'error');
    }
}

// ============================================
// TOGGLE PASSWORD VISIBILITY
// ============================================

function togglePassword(inputId, btn) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    const icon = btn.querySelector('i');
    if (inp.type === 'password') {
        inp.type = 'text';
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
    } else {
        inp.type = 'password';
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
    }
}

// ============================================
// LOGIN
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!checkFirebaseReady()) return;

            const email    = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;

            try {
                showNotification('Logging in...', 'info');
                await auth.signInWithEmailAndPassword(email, password);
            } catch (error) {
                console.error('Login error:', error);
                showNotification(getAuthErrorMessage(error.code), 'error');
            }
        });
    }

    // Signup is now handled by handleSignup() called from the modal form
});

// ============================================
// GOOGLE LOGIN
// ============================================

async function googleLogin() {
    if (!checkFirebaseReady()) return;

    const provider = new firebase.auth.GoogleAuthProvider();

    try {
        showNotification('Connecting to Google...', 'info');
        const result = await auth.signInWithPopup(provider);

        if (typeof database !== 'undefined' && database) {
            const userRef = database.ref(`users/${result.user.uid}`);
            const snapshot = await userRef.once('value');

            if (!snapshot.exists()) {
                await userRef.set({
                    name: result.user.displayName,
                    email: result.user.email,
                    createdAt: firebase.database.ServerValue.TIMESTAMP,
                    printers: {}
                });
            }
        }
    } catch (error) {
        console.error('Google login error:', error);
        if (error.code !== 'auth/popup-closed-by-user') {
            showNotification(getAuthErrorMessage(error.code), 'error');
        }
    }
}

// ============================================
// LOGOUT
// ============================================

async function logout() {
    if (!checkFirebaseReady()) return;

    try {
        await auth.signOut();
        showNotification('Logged out successfully.', 'success');
    } catch (error) {
        console.error('Logout error:', error);
        showNotification('Logout failed. Please try again.', 'error');
    }
}

// ============================================
// HELPER - FRIENDLY ERROR MESSAGES
// ============================================

function getAuthErrorMessage(code) {
    const messages = {
        'auth/user-not-found':      'No account found with this email.',
        'auth/wrong-password':      'Incorrect password. Please try again.',
        'auth/email-already-in-use':'An account with this email already exists.',
        'auth/invalid-email':       'Please enter a valid email address.',
        'auth/weak-password':       'Password must be at least 6 characters.',
        'auth/too-many-requests':   'Too many failed attempts. Please try again later.',
        'auth/network-request-failed': 'Network error. Check your connection.',
    };
    return messages[code] || 'An error occurred. Please try again.';
}

// ============================================
// GLOBAL EXPORTS
// ============================================

window.showLoginTab  = function(){}; // kept for compat
window.googleLogin   = googleLogin;
window.logout        = logout;
window.showNotification = showNotification;
window.showForgotPassword = showForgotPassword;
window.closeForgotModal   = closeForgotModal;
window.sendResetEmail     = sendResetEmail;
window.showSignupModal    = showSignupModal;
window.closeSignupModal   = closeSignupModal;
window.handleSignup       = handleSignup;
window.togglePassword     = togglePassword;

console.log('✅ Auth.js loaded successfully');
