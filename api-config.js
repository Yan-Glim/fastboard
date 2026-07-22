// 前端部署配置(可选)
// 前后端同源部署(默认):留空即可,页面直接请求同源的 /api/recognize
// 前后端分开部署:改成 API 服务的完整地址,例如:
//   window.BLACKBOARD_API_BASE = 'https://api.example.com';
//   window.BLACKBOARD_API_BASE = 'http://192.168.1.10:8000';
// 注意:跨域时服务端需允许该来源(server.py 默认已放开 CORS)
window.BLACKBOARD_API_BASE = '';
