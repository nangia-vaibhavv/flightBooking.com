import React, { useState } from 'react';
import './SeatSelector.css';

const SeatSelector = ({ flight, onSeatSelect, selectedSeat }) => {
  const [hoveredSeat, setHoveredSeat] = useState(null);

  // Generate seats layout (simplified - 6 seats per row for most flights)
  const generateSeats = () => {
    const seats = [];
    const rows = Math.ceil(flight.totalSeats / 6);
    const seatLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    
    for (let row = 1; row <= rows; row++) {
      const rowSeats = [];
      for (let i = 0; i < 6; i++) {
        const seatNumber = `${row}${seatLetters[i]}`;
        if (seats.length < flight.totalSeats) {
          rowSeats.push(seatNumber);
        }
      }
      if (rowSeats.length > 0) {
        seats.push(rowSeats);
      }
    }
    
    return seats;
  };

  const seatLayout = generateSeats();
  const availableSeats = flight.availableSeats || [];
  const bookedSeats = flight.bookedSeats || [];

  const getSeatStatus = (seatNumber) => {
    if (bookedSeats.includes(seatNumber)) return 'booked';
    if (availableSeats.includes(seatNumber)) return 'available';
    return 'unavailable';
  };

  const getSeatClass = (seatNumber) => {
    const status = getSeatStatus(seatNumber);
    let className = `seat ${status}`;
    
    if (selectedSeat === seatNumber) {
      className += ' selected';
    }
    
    if (hoveredSeat === seatNumber && status === 'available') {
      className += ' hovered';
    }
    
    return className;
  };

  const handleSeatClick = (seatNumber) => {
    if (getSeatStatus(seatNumber) === 'available') {
      onSeatSelect(seatNumber);
    }
  };

  return (
    <div className="seat-selector">
      <div className="seat-map-header">
        <h3>Select Your Seat</h3>
        <div className="seat-legend">
          <div className="legend-item">
            <div className="seat available small"></div>
            <span>Available</span>
          </div>
          <div className="legend-item">
            <div className="seat selected small"></div>
            <span>Selected</span>
          </div>
          <div className="legend-item">
            <div className="seat booked small"></div>
            <span>Booked</span>
          </div>
        </div>
      </div>

      <div className="aircraft">
        <div className="aircraft-nose">Front</div>
        
        <div className="seat-map">
          {seatLayout.map((row, rowIndex) => (
            <div key={rowIndex} className="seat-row">
              <div className="row-number">{rowIndex + 1}</div>
              
              <div className="seats-section">
                {row.slice(0, 3).map((seatNumber) => (
                  <button
                    key={seatNumber}
                    className={getSeatClass(seatNumber)}
                    onClick={() => handleSeatClick(seatNumber)}
                    onMouseEnter={() => setHoveredSeat(seatNumber)}
                    onMouseLeave={() => setHoveredSeat(null)}
                    disabled={getSeatStatus(seatNumber) !== 'available'}
                    title={`Seat ${seatNumber}`}
                  >
                    {seatNumber}
                  </button>
                ))}
              </div>

              <div className="aisle"></div>

              <div className="seats-section">
                {row.slice(3, 6).map((seatNumber) => (
                  <button
                    key={seatNumber}
                    className={getSeatClass(seatNumber)}
                    onClick={() => handleSeatClick(seatNumber)}
                    onMouseEnter={() => setHoveredSeat(seatNumber)}
                    onMouseLeave={() => setHoveredSeat(null)}
                    disabled={getSeatStatus(seatNumber) !== 'available'}
                    title={`Seat ${seatNumber}`}
                  >
                    {seatNumber}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selectedSeat && (
        <div className="selected-seat-info">
          <p>Selected Seat: <strong>{selectedSeat}</strong></p>
        </div>
      )}
    </div>
  );
};

export default SeatSelector;