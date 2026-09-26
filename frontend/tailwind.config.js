/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nunito', 'ui-rounded', 'system-ui', 'sans-serif'],
      },
      colors: {
        duo: {
          green: '#166534',
          'green-dark': '#14532D',
          'green-soft': '#DCFCE7',
          blue: '#1CB0F6',
          'blue-dark': '#1899D6',
          gold: '#FFC800',
          red: '#FF4B4B',
          'red-dark': '#EA2B2B',
          ink: '#3C3C3C',
          mute: '#777777',
          line: '#E5E5E5',
          mist: '#F7F7F7',
        },
      },
      boxShadow: {
        // Surfaces: two-layer shadows (tight contact + soft ambient) thay cho border
        duo: '0 1px 2px rgba(60, 60, 60, 0.05), 0 4px 12px rgba(60, 60, 60, 0.06)',
        card: '0 1px 2px rgba(60, 60, 60, 0.05), 0 4px 12px rgba(60, 60, 60, 0.06)',
        'card-hover': '0 2px 6px rgba(60, 60, 60, 0.06), 0 12px 28px rgba(60, 60, 60, 0.10)',
        // Khối lồng bên trong card, cần nổi nhẹ hơn card cha
        'card-inner': '0 1px 2px rgba(60, 60, 60, 0.04), 0 2px 8px rgba(60, 60, 60, 0.05)',
        // Sidebar / bottom nav: shadow một phía thay cho đường kẻ
        rail: '1px 0 0 rgba(60, 60, 60, 0.05), 6px 0 18px rgba(60, 60, 60, 0.05)',
        'nav-bar': '0 -1px 0 rgba(60, 60, 60, 0.05), 0 -6px 18px rgba(60, 60, 60, 0.07)',
        // Input: inset ring thay cho border, không gây layout shift khi focus
        input: 'inset 0 0 0 1.5px #E5E5E5',
        'input-focus': 'inset 0 0 0 2px #1CB0F6, 0 0 0 4px rgba(28, 176, 246, 0.15)',
        // Nút: giữ độ dày 3D kiểu Duolingo nhưng bằng shadow
        btn: '0 4px 0 #14532D, 0 6px 14px rgba(22, 101, 52, 0.28)',
        'btn-blue': '0 4px 0 #1899D6, 0 6px 14px rgba(28, 176, 246, 0.25)',
        'btn-ghost': '0 2px 0 rgba(60, 60, 60, 0.08), 0 3px 10px rgba(60, 60, 60, 0.08)',
        'btn-ghost-hover': '0 2px 0 rgba(60, 60, 60, 0.10), 0 6px 16px rgba(60, 60, 60, 0.12)',
        // Chip / select nhỏ
        chip: '0 1px 2px rgba(60, 60, 60, 0.06), 0 2px 6px rgba(60, 60, 60, 0.07)',
        // Trạng thái được chọn (nav item, item lịch sử)
        'ring-green': '0 0 0 2px rgba(22, 101, 52, 0.35), 0 4px 14px rgba(22, 101, 52, 0.18)',
        // Logo / avatar thương hiệu
        brand: '0 3px 0 #14532D, 0 6px 16px rgba(22, 101, 52, 0.30)',
      },
    },
  },
  plugins: [],
}
