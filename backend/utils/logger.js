const winston = require('winston');
const path = require('path');

const getLogSource = () => {
    try {
        const err = new Error();
        const stack = err.stack?.split('\n');
        
        if (!stack) return 'unknown';
        
        // Debug: Let's see what the stack looks like
        // console.log('Stack trace:', stack.slice(0, 10));
        
        // Look through more stack frames to find the actual caller
        for (let i = 1; i < stack.length; i++) {
            const line = stack[i];
            if (!line) continue;
            
            // Skip internal calls
            if (line.includes('node_modules') || 
                line.includes('winston') || 
                line.includes('getLogSource') ||
                line.includes('sourceFormat') ||
                line.includes('Object.write') ||
                line.includes('DerivedLogger') ||
                line.includes('Logger.write')) {
                continue;
            }
            
            // Match different stack trace formats more broadly
            const patterns = [
                /\(([^)]+):(\d+):(\d+)\)/,  // (file:line:col)
                /at\s+([^:]+):(\d+):(\d+)/,  // at file:line:col
                /at\s+.*?\s+\(([^)]+):(\d+):(\d+)\)/, // at function (file:line:col)
                /^\s*at\s+([^:]+):(\d+):(\d+)/ // at file:line:col (start of line)
            ];
            
            for (const pattern of patterns) {
                const match = line.match(pattern);
                if (match) {
                    try {
                        const filePath = path.relative(process.cwd(), match[1]);
                        const lineNumber = match[2];
                        return `${filePath}:${lineNumber}`;
                    } catch (pathError) {
                        // If path.relative fails, just use the filename
                        const fileName = path.basename(match[1]);
                        return `${fileName}:${match[2]}`;
                    }
                }
            }
        }
    } catch (error) {
        return 'unknown';
    }
    
    return 'unknown';
};

// Alternative approach: capture source at log time instead of format time
const captureSource = () => {
    const err = new Error();
    const stack = err.stack?.split('\n');
    
    if (!stack) return 'unknown';
    
    // Find the first stack frame that's not this function or winston internals
    for (let i = 1; i < stack.length; i++) {
        const line = stack[i];
        if (!line) continue;
        
        // Skip internal calls - be more specific about what to skip
        if (line.includes('node_modules') || 
            line.includes('winston') || 
            line.includes('captureSource') ||
            line.includes('logger.js') ||  // Skip calls from this logger file
            line.includes('Logger.') ||
            line.includes('DerivedLogger')) {
            continue;
        }
        
        const match = line.match(/\(([^)]+):(\d+):(\d+)\)/) || 
                     line.match(/at\s+([^:]+):(\d+):(\d+)/) ||
                     line.match(/at\s+.*?\s+\(([^)]+):(\d+):(\d+)\)/);
        
        if (match) {
            try {
                const filePath = path.relative(process.cwd(), match[1]);
                const lineNumber = match[2];
                return `${filePath}:${lineNumber}`;
            } catch (pathError) {
                const fileName = path.basename(match[1]);
                return `${fileName}:${match[2]}`;
            }
        }
    }
    
    return 'unknown';
};

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(info => {
            const level = info.level.toUpperCase().padEnd(5);
            const source = info.source || 'unknown';
            const baseMessage = `${info.timestamp} ${level} [${source}]: ${info.message}`;
            
            return info.stack ? `${baseMessage}\n${info.stack}` : baseMessage;
        })
    ),
    transports: [
        new winston.transports.Console({
            handleExceptions: true,
            handleRejections: true
        })
    ],
    exitOnError: false
});

// Override the log methods to capture source at call time
const originalLog = logger.log.bind(logger);

logger.log = function(level, message, meta = {}) {
    // Capture source here, at the actual call site
    const source = captureSource();
    
    // If meta is a string, treat it as part of the message
    if (typeof meta === 'string') {
        message = `${message} ${meta}`;
        meta = {};
    }
    
    // Add source to meta
    const enrichedMeta = { ...meta, source };
    
    return originalLog(level, message, enrichedMeta);
};

// Override individual level methods
['debug', 'info', 'warn', 'error'].forEach(level => {
    logger[level] = function(message, meta = {}) {
        return logger.log(level, message, meta);
    };
});

// Helper method for logging with additional context
logger.logWithContext = (level, message, context = {}) => {
    return logger.log(level, message, context);
};

module.exports = logger;