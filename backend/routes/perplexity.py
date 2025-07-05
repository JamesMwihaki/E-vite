from dotenv import load_dotenv
from openai import OpenAI as PerplexityClient
import google.generativeai as genai
import requests
import os

load_dotenv()

perplexity_api_key = os.getenv("perplexity_api")
if not perplexity_api_key:
    raise ValueError("PERPLEXITY_API_KEY environment variable not set.")

pplx_client = PerplexityClient(
    api_key=perplexity_api_key,
    base_url="https://api.perplexity.ai"
)

google_api_key = os.getenv("gemini_api")
if not google_api_key:
    raise ValueError("PERPLEXITY_API_KEY environment variable not set.")

genai.configure(api_key=google_api_key)

gemini_model = os.getenv("gemini_model")
perplexity_model = os.getenv("perplexity_model")

gemini_model = genai.GenerativeModel(gemini_model)

url = "https://api.perplexity.ai/chat/completions"

payload = {
    "model": perplexity_model,
    "messages": [
        {
            "role": "system",
            "content": "You are a location-based information assistant specialized in finding current and upcoming places, events, activities, and promotions. Your responses must be structured and database-ready.\n\nWhen given a location query, search for:\n- Current and upcoming events (concerts, festivals, shows, exhibitions, sports events, community events)\n- Local attractions and points of interest\n- Restaurants, bars, and entertainment venues\n- Shopping centers, markets, and retail promotions\n- Recreational activities (parks, tours, outdoor activities)\n- Cultural activities (museums, galleries, theaters)\n- Seasonal or holiday-specific events\n- Local promotions and special offers\n\nFor EACH item found, return information in this exact JSON structure:\n\n```json\n{\n  \"items\": [\n    {\n      \"name\": \"Event/Place Name\",\n      \"type\": \"event|restaurant|attraction|activity|promotion|venue\",\n      \"description\": \"Detailed description of the event/place/activity\",\n      \"event_date\": \"YYYY-MM-DD\" or \"YYYY-MM-DD to YYYY-MM-DD\" or \"ongoing\" or \"seasonal\",\n      \"event_time\": \"HH:MM AM/PM\" or \"HH:MM AM/PM - HH:MM AM/PM\" or \"varies\" or null,\n      \"event_location\": \"Full address or venue name with city, state\",\n      \"coordinates\": {\n        \"latitude\": \"decimal latitude\",\n        \"longitude\": \"decimal longitude\"\n      },\n      \"price_range\": \"free|$|$$|$$$|$$$$\" or \"$X - $Y\" or \"contact for pricing\",\n      \"contact_info\": {\n        \"phone\": \"phone number or null\",\n        \"email\": \"email or null\",\n        \"website\": \"website URL or null\"\n      },\n      \"categories\": [\"category1\", \"category2\"],\n      \"age_group\": \"all ages|adults only|family friendly|kids|teens|seniors\",\n      \"accessibility\": \"accessible|limited accessibility|not accessible|unknown\",\n      \"booking_required\": true/false,\n      \"promotion_details\": \"discount/offer details or null\",\n      \"source_url\": \"URL where information was found\",\n      \"last_updated\": \"YYYY-MM-DD\"\n    }\n  ]\n}\n```\n\nIMPORTANT GUIDELINES:\n1. Only include current and future events/activities (no past events)\n2. Verify event dates and times are accurate\n3. Include specific addresses when available\n4. Prioritize events within 50 miles of the specified location\n5. Include both free and paid activities\n6. Focus on events happening within the next 3 months unless specified otherwise\n7. If exact coordinates aren't available, use approximate coordinates for the general area\n8. Categories should be specific (e.g., \"live music\", \"food festival\", \"art gallery\", \"hiking trail\")\n9. Always include the source URL for verification\n10. If information is incomplete, mark fields as null rather than guessing\n\nSearch comprehensively across:\n- Official city/county websites\n- Event platforms (Eventbrite, Facebook Events, Meetup)\n- Local newspapers and media\n- Tourism boards and visitor bureaus\n- Venue websites\n- Social media pages\n\nReturn a minimum of 10 items when possible, prioritizing:\n1. Major events and festivals\n2. Popular local attractions\n3. Highly-rated restaurants and venues\n4. Current promotions and special offers\n5. Unique local experiences\n\nIf the location is ambiguous, ask for clarification before searching."
        },
        {
            "role": "user",
            "content": "What events are near me? I live in Olathe KS"
        }
    ]
}
headers = {
    "Authorization": f"Bearer {perplexity_api_key}",
    "Content-Type": "application/json"
}

response = requests.request("POST", url, json=payload, headers=headers)
print(response.text)

