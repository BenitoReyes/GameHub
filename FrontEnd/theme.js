// GameHub Global Theme System
// Include this script in any page to automatically apply saved theme

(function() {
    'use strict';
    
    // Apply theme immediately to prevent flash
    function applyTheme() {
        const isDarkMode = localStorage.getItem('gamehub_theme') !== null ? 
            JSON.parse(localStorage.getItem('gamehub_theme')) : false;
        document.body.className = isDarkMode ? '' : 'light';
        console.log('Theme applied:', isDarkMode ? 'Dark' : 'Light'); // Debug log
        return isDarkMode;
    }
    
    // Apply theme as soon as script loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyTheme);
    } else {
        applyTheme();
    }
    
    // Global theme utilities
    window.GameHubTheme = {
        // Apply theme to current page
        applyTheme: applyTheme,
        
        // Get current theme setting
        getCurrentTheme: function() {
            return localStorage.getItem('gamehub_theme') !== null ? 
                JSON.parse(localStorage.getItem('gamehub_theme')) : false;
        },
        
        // Set theme and apply immediately
        setTheme: function(isDarkMode) {
            localStorage.setItem('gamehub_theme', JSON.stringify(isDarkMode));
            document.body.className = isDarkMode ? '' : 'light';
            console.log('Theme set to:', isDarkMode ? 'Dark' : 'Light'); // Debug log
            return isDarkMode;
        },
        
        // Toggle theme
        toggleTheme: function() {
            const currentTheme = this.getCurrentTheme();
            return this.setTheme(!currentTheme);
        }
    };
    
    // Listen for storage changes (when theme changes in another tab)
    window.addEventListener('storage', function(e) {
        if (e.key === 'gamehub_theme') {
            console.log('Theme changed in another tab'); // Debug log
            applyTheme();
        }
    });
})();