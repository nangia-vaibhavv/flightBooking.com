import React from 'react';
import './BookingCard.css';

const BookingCard = ({ booking }) => {
  const formatTime = (timeString) => {
    return new Date(`2000-01-01T${timeString}`).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'confirmed':
        return '#28a745';
      case 'cancelled':
        return '#dc3545';
      case 'pending':
        return '#ffc107';
      default:
        return '#6c757d';
    }
  };

  const flight = booking.flight;

  return (
    <div className="booking-card">
      <div className="booking-header">
        <div className="booking-reference">
          <span className="label">Booking Reference</span>
          <span className="reference-number">{booking.bookingReference}</span>
        </div>
        <div className="booking-status">
          <span 
            className="status-badge"
            style={{ backgroundColor: getStatusColor(booking.status) }}
          >
            {booking.status?.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="flight-info">
        <div className="airline-details">
          <h3>{flight?.airline}</h3>
          <span className="flight-number">{flight?.flightNumber}</span>
        </div>

        <div className="route-details">
          <div className="route-info">
            <div className="departure">
              <div className="time">{flight?.departureTime && formatTime(flight.departureTime)}</div>
              <div className="city">{flight?.from}</div>
            </div>
            
            <div className="flight-arrow">
              <div className="arrow-line"></div>
              <div className="plane-icon">✈️</div>
              <div className="arrow-line"></div>
            </div>
            
            <div className="arrival">
              <div className="time">{flight?.arrivalTime && formatTime(flight.arrivalTime)}</div>
              <div className="city">{flight?.to}</div>
            </div>
          </div>
          
          <div className="flight-date">
            {flight?.date && formatDate(flight.date)}
          </div>
        </div>
      </div>

      <div className="passenger-info">
        <div className="info-group">
          <span className="label">Passenger</span>
          <span className="value">{booking.passengerName}</span>
        </div>
        
        <div className="info-group">
          <span className="label">Seat</span>
          <span className="value seat-number">{booking.seatNumber}</span>
        </div>
        
        <div className="info-group">
          <span className="label">Price</span>
          <span className="value price">₹{booking.price?.toLocaleString()}</span>
        </div>
      </div>

      <div className="booking-footer">
        <div className="booking-date">
          <span className="label">Booked on:</span>
          <span>{new Date(booking.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })}</span>
        </div>
        
        {booking.status === 'confirmed' && (
          <div className="booking-actions">
            <button className="action-btn secondary">Download Ticket</button>
            <button className="action-btn danger">Cancel Booking</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingCard;