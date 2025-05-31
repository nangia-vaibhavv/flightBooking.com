import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Navbar.css';

const Navbar = ({ user, onLogout }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    onLogout();
    navigate('/');
  };

  return (
    <nav className="navbar">
      <div className="nav-container">
        <Link to="/" className="nav-logo">
          ✈️ FlightBook
        </Link>
        
        <div className="nav-menu">
          {user ? (
            <>
              <Link to="/flights" className="nav-link">Search Flights</Link>
              <Link to="/bookings" className="nav-link">My Bookings</Link>
              {user.role === 'admin' && (
                <Link to="/admin" className="nav-link">Admin</Link>
              )}
              <div className="nav-user">
                <span>Hello, {user.name}</span>
                <button onClick={handleLogout} className="logout-btn">
                  Logout
                </button>
              </div>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link">Login</Link>
              <Link to="/register" className="nav-link nav-cta">Register</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;