/**
 * Toast Notification Utility
 *
 * Wrapper around react-hot-toast for consistent notifications
 */

import toast from 'react-hot-toast';

export const showToast = {
  success: (message: string) => {
    toast.success(message, {
      duration: 4000,
      position: 'top-right',
      style: {
        background: '#10b981',
        color: '#fff',
        fontFamily: 'Noto Sans Tamil, sans-serif',
      },
      icon: '✅',
    });
  },

  error: (message: string) => {
    toast.error(message, {
      duration: 5000,
      position: 'top-right',
      style: {
        background: '#ef4444',
        color: '#fff',
        fontFamily: 'Noto Sans Tamil, sans-serif',
      },
      icon: '❌',
    });
  },

  loading: (message: string) => {
    return toast.loading(message, {
      position: 'top-right',
      style: {
        fontFamily: 'Noto Sans Tamil, sans-serif',
      },
    });
  },

  dismiss: (toastId: string) => {
    toast.dismiss(toastId);
  },

  promise: <T,>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string;
      error: string;
    }
  ) => {
    return toast.promise(
      promise,
      {
        loading: messages.loading,
        success: messages.success,
        error: messages.error,
      },
      {
        position: 'top-right',
        style: {
          fontFamily: 'Noto Sans Tamil, sans-serif',
        },
      }
    );
  },
};

export default showToast;
