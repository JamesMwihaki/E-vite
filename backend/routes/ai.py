import os
import json
import requests
from bs4 import BeautifulSoup
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

# --- Configuration ---
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

# Any event page URL can go here
url = 'https://explorelawrence.com/events/' 

# --- 1. Define the Master Prompt ---
# This is the most important part. We tell the AI exactly what to do.
prompt = """
You are an expert data extraction bot. Your task is to analyze the text from a website and identify all upcoming events.

From the text provided, extract the following information for each event:
- title
- date (be as specific as possible, including year if available)
- location
- a brief description

Here is the website text:
"""

# --- 2. Fetch and Clean the Website Text ---
try:
    response = requests.get(url)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser') 
    # Get all human-readable text from the page
    # The separator adds spaces between text from different tags
    text_content = soup.get_text(separator=' ', strip=True)
    
except requests.exceptions.RequestException as e:
    print(f"Error fetching the URL: {e}")
    exit()

# --- 3. Call the Generative AI Model ---
model = genai.GenerativeModel(os.getenv("MODEL")) # Using a fast and capable model
try:
    # Combine the master prompt with the text we scraped
    full_prompt = prompt + text_content
    ai_response = model.generate_content(full_prompt)
    print(ai_response.text)
    
except Exception as e:
    print(f"An error occurred with the AI model response: {e}")    
    exit()

