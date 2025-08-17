class Logger {
  constructor() {
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const formattedMessage = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    
    let logEntry = `[${timestamp}] [${level.toUpperCase()}] ${formattedMessage}`;
    
    if (data) {
      logEntry += `\nData: ${JSON.stringify(data, null, 2)}`;
    }
    
    return logEntry;
  }

  colorize(text, color) {
    if (process.env.NODE_ENV === 'production') {
      return text; // No colors in production logs
    }
    return `${this.colors[color]}${text}${this.colors.reset}`;
  }

  info(message, data = null) {
    const formattedMessage = this.formatMessage('info', message, data);
    console.log(this.colorize(formattedMessage, 'cyan'));
  }

  warn(message, data = null) {
    const formattedMessage = this.formatMessage('warn', message, data);
    console.warn(this.colorize(formattedMessage, 'yellow'));
  }

  error(message, data = null) {
    const formattedMessage = this.formatMessage('error', message, data);
    console.error(this.colorize(formattedMessage, 'red'));
  }

  debug(message, data = null) {
    if (process.env.NODE_ENV !== 'production') {
      const formattedMessage = this.formatMessage('debug', message, data);
      console.log(this.colorize(formattedMessage, 'magenta'));
    }
  }

  success(message, data = null) {
    const formattedMessage = this.formatMessage('success', message, data);
    console.log(this.colorize(formattedMessage, 'green'));
  }

  // Request logging
  request(req, res, responseTime) {
    const { method, url, ip } = req;
    const { statusCode } = res;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const user = req.user?.username || 'Anonymous';
    
    const color = statusCode >= 400 ? 'red' : statusCode >= 300 ? 'yellow' : 'green';
    const message = `${method} ${url} ${statusCode} ${responseTime}ms - ${user} - ${ip}`;
    
    console.log(this.colorize(`[${new Date().toISOString()}] [REQUEST] ${message}`, color));
  }

  // Database operation logging
  database(operation, collection, details = null) {
    const message = `DB ${operation.toUpperCase()}: ${collection}`;
    this.debug(message, details);
  }

  // Authentication logging
  auth(action, username, success = true, details = null) {
    const level = success ? 'info' : 'warn';
    const message = `AUTH ${action.toUpperCase()}: ${username} - ${success ? 'SUCCESS' : 'FAILED'}`;
    
    if (success) {
      this.info(message, details);
    } else {
      this.warn(message, details);
    }
  }

  // API logging
  api(endpoint, method, user, duration, success = true) {
    const status = success ? 'SUCCESS' : 'FAILED';
    const message = `API ${method} ${endpoint} - ${user} - ${duration}ms - ${status}`;
    
    if (success) {
      this.info(message);
    } else {
      this.error(message);
    }
  }
}

module.exports = new Logger();