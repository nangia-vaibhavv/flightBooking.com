import React from 'react';
import './FlightCard.css';

const FlightCard = ({ flight, onBook }) => {
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

  const availableSeats = flight.availableSeats?.length || 0;
  const totalSeats = flight.totalSeats || 0;
  const occupancyRate = totalSeats > 0 ? ((totalSeats - availableSeats) / totalSeats) * 100 : 0;

  return (
    <div className="flight-card">
      <div className="flight-header">
        <div className="airline-info">
          <h3>{flight.airline}</h3>
          <span className="flight-number">{flight.flightNumber}</span>
        </div>
        <div className="price-info">
          <span className="price">₹{flight.basePrice?.toLocaleString()}</span>
          <span className="per-person">per person</span>
        </div>
      </div>

      <div className="flight-details">
        <div className="route-info">
          <div className="departure">
            <div className="time">{formatTime(flight.departureTime)}</div>
            <div className="city">{flight.from}</div>
          </div>
          
          <div className="flight-duration">
            <div className="line"></div>
            <div className="plane-icon">✈️</div>
            <div className="line"></div>
          </div>
          
          <div className="arrival">
            <div className="time">{formatTime(flight.arrivalTime)}</div>
            <div className="city">{flight.to}</div>
          </div>
        </div>

        <div className="flight-meta">
          <div className="date">{formatDate(flight.date)}</div>
          <div className="seats-info">
            <span className={`seats-left ${availableSeats < 10 ? 'low' : ''}`}>
              {availableSeats} seats left
            </span>
            {occupancyRate > 70 && (
              <span className="filling-fast">Filling fast!</span>
            )}
          </div>
        </div>
      </div>

      <div className="flight-actions">
        <button 
          className="book-btn" 
          onClick={() => onBook(flight)}
          disabled={availableSeats === 0}
        >
          {availableSeats === 0 ? 'Sold Out' : 'Book Now'}
        </button>
      </div>
    </div>
  );
};

export default FlightCard;