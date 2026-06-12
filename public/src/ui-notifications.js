// Custom Premium UI Notifications & Modals Library
// Injecting styles dynamically to keep the library self-contained.
const styleEl = document.createElement("style");
styleEl.textContent = `
  /* Toast Notification Container */
  #custom-toast-container {
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 360px;
    width: calc(100vw - 40px);
    pointer-events: none;
  }
  
  @media (max-width: 576px) {
    #custom-toast-container {
      top: 15px;
      right: 20px;
      left: 20px;
      width: auto;
    }
  }

  /* Toast Card styles */
  .custom-toast {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.5);
    border-radius: 14px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.08);
    pointer-events: auto;
    animation: toast-slide-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    transition: all 0.3s ease;
  }

  .custom-toast.toast-fade-out {
    animation: toast-fade-out 0.3s ease forwards;
  }

  @keyframes toast-slide-in {
    from { opacity: 0; transform: translateY(-20px) scale(0.95); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @keyframes toast-fade-out {
    from { opacity: 1; transform: scale(1); }
    to { opacity: 0; transform: scale(0.9) translateY(-10px); }
  }

  /* Toast Types styling */
  .custom-toast-success { border-left: 4px solid #10b981; }
  .custom-toast-error { border-left: 4px solid #ef4444; }
  .custom-toast-info { border-left: 4px solid #3b82f6; }
  .custom-toast-warning { border-left: 4px solid #f59e0b; }

  .custom-toast-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .custom-toast-success .custom-toast-icon { color: #10b981; }
  .custom-toast-error .custom-toast-icon { color: #ef4444; }
  .custom-toast-info .custom-toast-icon { color: #3b82f6; }
  .custom-toast-warning .custom-toast-icon { color: #f59e0b; }

  .custom-toast-content {
    flex-grow: 1;
    font-size: 13.5px;
    font-weight: 500;
    color: #1e293b;
    line-height: 1.4;
  }

  .custom-toast-close {
    background: none;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 14px;
    padding: 0;
    transition: color 0.2s;
  }

  .custom-toast-close:hover { color: #475569; }

  /* Modal Overlay Base */
  .custom-modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: modal-overlay-fade-in 0.25s ease forwards;
  }

  @keyframes modal-overlay-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  /* Modal Dialog Card */
  .custom-modal-card {
    background: white;
    width: 100%;
    max-width: 440px;
    border-radius: 20px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    animation: modal-card-bounce-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  @keyframes modal-card-bounce-in {
    from { opacity: 0; transform: scale(0.9) translateY(20px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  .custom-modal-header {
    padding: 24px 24px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .custom-modal-title {
    font-family: 'Poppins', sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: #0f172a;
    margin: 0;
  }

  .custom-modal-body {
    padding: 0 24px 20px;
    font-size: 14px;
    color: #64748b;
    line-height: 1.5;
  }

  .custom-modal-footer {
    padding: 16px 24px 24px;
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    background: #f8fafc;
    border-top: 1px solid #f1f5f9;
  }

  /* Modal Icon Status styles */
  .modal-icon-container {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    font-size: 20px;
    flex-shrink: 0;
  }

  .modal-icon-warning { background: #fef3c7; color: #d97706; }
  .modal-icon-danger { background: #fee2e2; color: #ef4444; }
  .modal-icon-info { background: #dbeafe; color: #3b82f6; }

  /* Premium Buttons inside Modals */
  .custom-btn {
    padding: 10px 20px;
    border-radius: 10px;
    font-weight: 600;
    font-size: 13.5px;
    border: none;
    cursor: pointer;
    transition: all 0.2s ease;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .custom-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .custom-btn-secondary {
    background: white;
    border: 1px solid #cbd5e1;
    color: #475569;
  }
  .custom-btn-secondary:hover:not(:disabled) {
    background: #f1f5f9;
    border-color: #94a3b8;
  }

  .custom-btn-primary {
    background: #10b981;
    color: white;
    box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2);
  }
  .custom-btn-primary:hover:not(:disabled) {
    background: #059669;
    box-shadow: 0 6px 14px rgba(16, 185, 129, 0.3);
  }

  .custom-btn-danger {
    background: #ef4444;
    color: white;
    box-shadow: 0 4px 10px rgba(239, 68, 68, 0.2);
  }
  .custom-btn-danger:hover:not(:disabled) {
    background: #dc2626;
    box-shadow: 0 6px 14px rgba(239, 68, 68, 0.3);
  }

  /* Full Screen Loading Overlay */
  #custom-loading-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 23, 42, 0.6);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    z-index: 10010;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: white;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }

  #custom-loading-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  .loading-spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255, 255, 255, 0.15);
    border-left-color: #10b981;
    border-radius: 50%;
    animation: spinner-rotate 0.8s linear infinite;
  }

  @keyframes spinner-rotate {
    to { transform: rotate(360deg); }
  }

  .loading-text {
    font-family: 'Poppins', sans-serif;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.5px;
  }
  
  /* Dark Mode Support overrides */
  body.dark-mode .custom-toast {
    background: rgba(30, 41, 59, 0.9);
    border-color: rgba(255, 255, 255, 0.08);
  }
  body.dark-mode .custom-toast-content {
    color: #f8fafc;
  }
  body.dark-mode .custom-modal-card {
    background: #1e293b;
    border-color: rgba(255, 255, 255, 0.08);
  }
  body.dark-mode .custom-modal-title {
    color: #f8fafc;
  }
  body.dark-mode .custom-modal-body {
    color: #94a3b8;
  }
  body.dark-mode .custom-modal-footer {
    background: #0f172a;
    border-top-color: #1e293b;
  }
  body.dark-mode .custom-btn-secondary {
    background: #1e293b;
    border-color: #475569;
    color: #cbd5e1;
  }
  body.dark-mode .custom-btn-secondary:hover:not(:disabled) {
    background: #334155;
  }
`;
document.head.appendChild(styleEl);

// Initialize containers on DOM ready
let toastContainer;
let loadingOverlay;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "custom-toast-container";
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function getLoadingOverlay() {
  if (!loadingOverlay) {
    loadingOverlay = document.createElement("div");
    loadingOverlay.id = "custom-loading-overlay";
    loadingOverlay.innerHTML = `
      <div class="loading-spinner"></div>
      <div class="loading-text" id="custom-loading-text">Please wait...</div>
    `;
    document.body.appendChild(loadingOverlay);
  }
  return loadingOverlay;
}

// Map types to Bootstrap Icons
const ICONS = {
  success: "bi-check-circle-fill",
  error: "bi-exclamation-octagon-fill",
  info: "bi-info-circle-fill",
  warning: "bi-exclamation-triangle-fill"
};

// Toast notification function
export function showToast(message, type = "success", duration = 3500) {
  const container = getToastContainer();
  const toast = document.createElement("div");
  toast.className = `custom-toast custom-toast-${type}`;

  const iconName = ICONS[type] || ICONS.info;
  toast.innerHTML = `
    <div class="custom-toast-icon"><i class="bi ${iconName}"></i></div>
    <div class="custom-toast-content">${message}</div>
    <button class="custom-toast-close" aria-label="Close"><i class="bi bi-x"></i></button>
  `;

  // Close button trigger
  toast.querySelector(".custom-toast-close").addEventListener("click", () => {
    removeToast(toast);
  });

  container.appendChild(toast);

  // Auto-close countdown
  const autoCloseTimeout = setTimeout(() => {
    removeToast(toast);
  }, duration);

  // Keep track of timeout in case manually closed
  toast.dataset.timeoutId = autoCloseTimeout;
}

function removeToast(toast) {
  if (toast.classList.contains("toast-fade-out")) return;
  
  if (toast.dataset.timeoutId) {
    clearTimeout(parseInt(toast.dataset.timeoutId));
  }
  
  toast.classList.add("toast-fade-out");
  toast.addEventListener("animationend", () => {
    toast.remove();
  });
}

// Unified Modal Confirmation Function
export function showConfirm({ title, message, type = "warning", confirmText = "Confirm", cancelText = "Cancel", onConfirm, onCancel = null }) {
  const overlay = document.createElement("div");
  overlay.className = "custom-modal-overlay";

  const iconTheme = type === "danger" ? "modal-icon-danger" : (type === "info" ? "modal-icon-info" : "modal-icon-warning");
  const iconName = type === "danger" ? "bi-trash3-fill" : (type === "info" ? "bi-info-lg" : "bi-exclamation-lg");

  overlay.innerHTML = `
    <div class="custom-modal-card" role="dialog" aria-modal="true">
      <div class="custom-modal-header">
        <div class="modal-icon-container ${iconTheme}"><i class="bi ${iconName}"></i></div>
        <h5 class="custom-modal-title">${title}</h5>
      </div>
      <div class="custom-modal-body">
        ${message}
      </div>
      <div class="custom-modal-footer">
        <button class="custom-btn custom-btn-secondary" id="modal-cancel-btn">${cancelText}</button>
        <button class="custom-btn ${type === 'danger' ? 'custom-btn-danger' : 'custom-btn-primary'}" id="modal-confirm-btn">${confirmText}</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const confirmBtn = overlay.querySelector("#modal-confirm-btn");
  const cancelBtn = overlay.querySelector("#modal-cancel-btn");

  const cleanUpModal = () => {
    document.removeEventListener("keydown", keyListener);
    overlay.remove();
  };

  // Keyboard navigation & confirm logic
  const keyListener = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelBtn.click();
    } else if (e.key === "Enter") {
      e.preventDefault();
      confirmBtn.click();
    }
  };

  document.addEventListener("keydown", keyListener);

  // Close and trigger callback
  cancelBtn.addEventListener("click", () => {
    cleanUpModal();
    if (onCancel) onCancel();
  });

  confirmBtn.addEventListener("click", async () => {
    // Prevent double submissions
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Processing...`;
    
    try {
      await onConfirm();
    } catch (err) {
      console.error("Error in confirmation action callback:", err);
    } finally {
      cleanUpModal();
    }
  });

  // Autofocus the confirm button
  confirmBtn.focus();
}

// Specific Delete Confirmation wrapping
export function showDeleteConfirm(message, title = "Delete Confirmation", onDelete, onCancel = null) {
  showConfirm({
    title,
    message,
    type: "danger",
    confirmText: "Delete",
    cancelText: "Cancel",
    onConfirm: onDelete,
    onCancel
  });
}

// Full screen loading indicator
export function showLoading(message = "Processing request...") {
  const overlay = getLoadingOverlay();
  document.getElementById("custom-loading-text").textContent = message;
  overlay.classList.add("visible");
}

export function hideLoading() {
  const overlay = getLoadingOverlay();
  overlay.classList.remove("visible");
}

// Global window overrides for native alerts & prompts
window.showAlert = (msg, type = "info") => {
  showToast(msg, type);
};

// Global override for native alert()
window.alert = (msg) => {
  showToast(msg, "info");
};

// Global Unhandled Error Handling
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Global Error Caught:", error || message);
  showToast(`An unexpected error occurred: ${message}`, "error");
  return false;
};

window.addEventListener("unhandledrejection", function(event) {
  console.error("Unhandled Promise Rejection Caught:", event.reason);
  const errorMsg = event.reason?.message || event.reason || "Unknown promise rejection";
  showToast(`Database / Network error: ${errorMsg}`, "error");
});

// Offline & Online Connection Trackers
window.addEventListener("online", () => {
  showToast("Internet connection restored! Resyncing database...", "success");
});

window.addEventListener("offline", () => {
  showToast("You are offline. Hifz Portal is running in local backup mode.", "warning");
});
