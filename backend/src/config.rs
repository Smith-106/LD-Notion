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
    /// `SQLite` 数据库文件路径
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
        let database_path = std::env::var("LDN_DATABASE_PATH").map_or_else(|_| PathBuf::from("data/ld-notion.db"), PathBuf::from);
        let storage_root = std::env::var("LDN_STORAGE_ROOT").map_or_else(|_| PathBuf::from("data/storage"), PathBuf::from);

        Self { host, port, database_path, storage_root }
    }

    /// 获取完整的监听地址
    #[must_use]
    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// 验证配置合法性
    pub fn validate(&self) -> Result<(), String> {
        if self.port == 0 {
            return Err("端口号不能为 0".to_string());
        }
        if self.database_path.as_os_str().is_empty() {
            return Err("数据库路径不能为空".to_string());
        }
        if self.storage_root.as_os_str().is_empty() {
            return Err("存储根目录不能为空".to_string());
        }
        Ok(())
    }
}
