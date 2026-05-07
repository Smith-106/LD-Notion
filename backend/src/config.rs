// 环境配置模块
// 从环境变量加载运行时配置，提供合理的默认值

use std::path::PathBuf;

/// 应用运行时配置
#[derive(Debug, Clone)]
pub struct Config {
    /// 服务器监听地址
    pub host: String,
    /// 服务器监听端口
    pub port: u16,
    /// SQLite 数据库文件路径
    pub database_path: PathBuf,
    /// Markdown 文件存储根目录
    pub storage_root: PathBuf,
}

impl Config {
    /// 从环境变量加载配置，缺失时使用默认值
    pub fn from_env() -> Self {
        let host = std::env::var("LDN_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
        let port = std::env::var("LDN_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(3000);
        let database_path = std::env::var("LDN_DATABASE_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/ld-notion.db"));
        let storage_root = std::env::var("LDN_STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("data/storage"));

        Config {
            host,
            port,
            database_path,
            storage_root,
        }
    }

    /// 获取完整的监听地址
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}
