import './App.css';
import React from 'react';
import {BrowserRouter as Router, Routes, Route} from "react-router-dom";
import CreateEvent from './components/CreateEvent';
import LandingPage from './components/LandingPage';
import Header from './components/ui/Header';
import NavigationBar from './components/ui/NavigationBar';

function App() {
  const styles = 
  `
    /* Combined CSS for Header and Navigation */

    /* General clickable elements */
    .clickable {
        cursor: pointer;
        color: blue;
        font-family: monospace;
    }

    a.clickable {
        color: blue;
    }

    /* Navigation items */
    .nav-item {
        cursor: pointer;
        margin-right: 5px;
    }

    .nav-item.active {
        color: #000;
    }

    .nav-item:hover {
      text-decoration: none;
      color: green;
    }

    /* Create event link styling */
    .create-event-link {
        color: green;
    }

    /* Card and text styling */
    .card-text {
        color: #333;
    }

   
    /* Button styling */
   

    /* Guest selection positioning */
    .select_guest {
        margin-left: 300px;
    }

    .select_guests {
        position: absolute;
        margin-left: 90px;
    }
  `;


  const handleReturnHome= () => {
    console.log("Returning home")
  };

  const handleUserInfo = () => {
    console.log("user Info")
  };
  const activeTab= () => {
    console.log("user Info")
  };
  const handleSetActive= () => {
    console.log("user Info")
  };

  return (
    <div className="ascii-container" style={{ 
            fontFamily: 'monospace', 
            backgroundColor: '#f0f0f0', 
            whiteSpace: 'pre',
            padding: '20px',
            maxWidth: '350px',
            borderRadius: '8px', 
            margin: '0 auto',
        }}>
      <Router>
        <style>{styles}</style>
        <Header onReturnHome={handleReturnHome} onUserInfo={handleUserInfo} />
        <Routes>
          <Route path="/" element={<LandingPage/>}/>
          <Route path="/landing" element={<LandingPage />} />
          <Route  path="/create-event" element={<CreateEvent/>}/>
        
        </Routes>
        <NavigationBar activeTab={activeTab} onSetActive={handleSetActive} />
      </Router>
    </div>
  );
}

export default App;
