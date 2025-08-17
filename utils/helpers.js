const crypto = require('crypto');

class Helpers {
  // Date and time utilities
  formatDate(date, format = 'ISO') {
    const d = new Date(date);
    
    switch (format) {
      case 'ISO':
        return d.toISOString();
      case 'date':
        return d.toISOString().split('T')[0];
      case 'time':
        return d.toTimeString().split(' ')[0];
      case 'datetime':
        return d.toLocaleString();
      case 'readable':
        return d.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      default:
        return d.toISOString();
    }
  }

  isValidDate(date) {
    const d = new Date(date);
    return d instanceof Date && !isNaN(d);
  }

  addMinutes(date, minutes) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  }

  addHours(date, hours) {
    const d = new Date(date);
    d.setHours(d.getHours() + hours);
    return d;
  }

  addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  getDayOfWeek(date) {
    return new Date(date).getDay(); // 0 = Sunday, 6 = Saturday
  }

  isSameDay(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    return d1.toDateString() === d2.toDateString();
  }

  getTimeDifference(startDate, endDate, unit = 'minutes') {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();

    switch (unit) {
      case 'milliseconds':
        return diffMs;
      case 'seconds':
        return Math.floor(diffMs / 1000);
      case 'minutes':
        return Math.floor(diffMs / (1000 * 60));
      case 'hours':
        return Math.floor(diffMs / (1000 * 60 * 60));
      case 'days':
        return Math.floor(diffMs / (1000 * 60 * 60 * 24));
      default:
        return diffMs;
    }
  }

  // String utilities
  capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  }

  titleCase(str) {
    return str.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  }

  slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^\w ]+/g, '')
      .replace(/ +/g, '-');
  }

  truncate(str, length = 100, suffix = '...') {
    if (str.length <= length) return str;
    return str.substring(0, length) + suffix;
  }

  generateRandomString(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  // Validation utilities
  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  isValidPhoneNumber(phone) {
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
  }

  isValidUsername(username) {
    // Apartment format: apartment + number
    const apartmentRegex = /^apartment\d+$/i;
    return apartmentRegex.test(username);
  }

  isStrongPassword(password) {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return strongPasswordRegex.test(password);
  }

  // Object utilities
  pick(obj, keys) {
    const result = {};
    keys.forEach(key => {
      if (key in obj) {
        result[key] = obj[key];
      }
    });
    return result;
  }

  omit(obj, keys) {
    const result = { ...obj };
    keys.forEach(key => {
      delete result[key];
    });
    return result;
  }

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const clonedObj = {};
      Object.keys(obj).forEach(key => {
        clonedObj[key] = this.deepClone(obj[key]);
      });
      return clonedObj;
    }
  }

  isEmpty(value) {
    if (value == null) return true;
    if (typeof value === 'string') return value.trim().length === 0;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  }

  // Array utilities
  unique(array) {
    return [...new Set(array)];
  }

  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const group = item[key];
      groups[group] = groups[group] || [];
      groups[group].push(item);
      return groups;
    }, {});
  }

  sortBy(array, key, order = 'asc') {
    return array.sort((a, b) => {
      if (order === 'desc') {
        return b[key] > a[key] ? 1 : -1;
      }
      return a[key] > b[key] ? 1 : -1;
    });
  }

  // Number utilities
  roundTo(number, decimals = 2) {
    return Math.round(number * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  }

  isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
  }

  // Response utilities
  successResponse(data, message = 'Success') {
    return {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    };
  }

  errorResponse(message = 'Error', errors = null) {
    const response = {
      success: false,
      message,
      timestamp: new Date().toISOString()
    };
    
    if (errors) {
      response.errors = errors;
    }
    
    return response;
  }

  paginationResponse(data, page, limit, total) {
    return {
      success: true,
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      timestamp: new Date().toISOString()
    };
  }

  // Reservation utilities
  isTimeSlotAvailable(existingReservations, startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);

    return !existingReservations.some(reservation => {
      const reservationStart = new Date(reservation.startTime);
      const reservationEnd = new Date(reservation.endTime);

      // Check for any overlap
      return (
        (start >= reservationStart && start < reservationEnd) ||
        (end > reservationStart && end <= reservationEnd) ||
        (start <= reservationStart && end >= reservationEnd)
      );
    });
  }

  generateTimeSlots(startTime, endTime, intervalMinutes = 30) {
    const slots = [];
    const start = new Date(startTime);
    const end = new Date(endTime);
    
    let current = new Date(start);
    
    while (current < end) {
      const slotEnd = new Date(current.getTime() + (intervalMinutes * 60 * 1000));
      if (slotEnd <= end) {
        slots.push({
          startTime: current.toISOString(),
          endTime: slotEnd.toISOString(),
          duration: intervalMinutes
        });
      }
      current = new Date(current.getTime() + (intervalMinutes * 60 * 1000));
    }
    
    return slots;
  }

  isWithinOperatingHours(dateTime, operatingHours) {
    const date = new Date(dateTime);
    const dayOfWeek = date.getDay();
    
    // Check if amenity operates on this day
    if (!operatingHours.days.includes(dayOfWeek)) {
      return false;
    }
    
    const [startHour, startMinute] = operatingHours.start.split(':').map(Number);
    const [endHour, endMinute] = operatingHours.end.split(':').map(Number);
    
    const timeMinutes = date.getHours() * 60 + date.getMinutes();
    const startMinutes = startHour * 60 + startMinute;
    const endMinutes = endHour * 60 + endMinute;
    
    return timeMinutes >= startMinutes && timeMinutes <= endMinutes;
  }

  // Security utilities
  hashString(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  generateSecureToken(length = 32) {
    return crypto.randomBytes(length).toString('base64url');
  }

  // Environment utilities
  isDevelopment() {
    return process.env.NODE_ENV === 'development';
  }

  isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  isTest() {
    return process.env.NODE_ENV === 'test';
  }

  getEnvironment() {
    return process.env.NODE_ENV || 'development';
  }
}

module.exports = new Helpers();